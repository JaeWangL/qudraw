import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { InkRecorder } from "./InkRecorder";
import { InkInputArbiter } from "./InkInputArbiter";
import { InkInputController } from "./InkInputController";
import type { InkMode } from "./InkRecorder";

interface ModeSession {
  recorder: InkRecorder;
  input: InkInputArbiter;
  scene: readonly ExcalidrawElement[];
  history: Array<readonly ExcalidrawElement[]>;
  future: Array<readonly ExcalidrawElement[]>;
  metrics: unknown[];
  ratings: Record<string, number>;
}
const makeSession = (): ModeSession => ({
  recorder: new InkRecorder(),
  input: new InkInputArbiter(),
  scene: [],
  history: [[]],
  future: [],
  metrics: [],
  ratings: {},
});
const uiOptions = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveToActiveFile: false,
    saveAsImage: false,
    toggleTheme: false,
  },
  tools: { image: false },
} as const;
const modeNames = { classic: "기존 필기", notebook: "노트 필기" };
const ratingLabels = [
  ["trailing", "펜 뒤로 잉크가 밀리나요?"],
  ["joining", "펜을 떼었는데 획이 붙나요?"],
  ["smoothing", "글씨 모양이 과하게 바뀌나요?"],
] as const;
const formatMs = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)} ms`;

export function InkLab() {
  const [mode, setMode] = useState<InkMode>("notebook");
  const [tool, setTool] = useState<"freedraw" | "eraser">("freedraw");
  const [pencilOnly, setPencilOnly] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [clearPending, setClearPending] = useState(false);
  const [, refresh] = useState(0);
  const [sessions] = useState(() => ({
    classic: makeSession(),
    notebook: makeSession(),
  }));
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const changingView = useRef(false);
  const pendingCommit = useRef<number | null>(null);
  const modeRef = useRef(mode);
  const session = sessions[mode];
  const initialData = useMemo(
    () => ({
      elements: structuredClone(sessions[mode].scene),
      appState: {
        activeTool: {
          type: "freedraw" as const,
          customType: null,
          locked: false,
          lastActiveTool: null,
        },
        currentItemStrokeWidth: 0.5,
        currentItemStrokeColor: "#213c35",
        currentItemRoughness: 0,
        viewBackgroundColor: "transparent",
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 as AppState["zoom"]["value"] },
      },
    }),
    [mode, sessions],
  );
  const captureCapabilities = {
    secureContext: window.isSecureContext,
    coalescedEventsAvailable:
      typeof PointerEvent !== "undefined" &&
      "getCoalescedEvents" in PointerEvent.prototype,
  };
  const summary = panelOpen ? session.recorder.summary() : null;
  const update = useCallback(() => refresh((value) => value + 1), []);

  const commit = useCallback(() => {
    pendingCommit.current = null;
    const current = sessions[modeRef.current];
    // A rapid next stroke can start before the pending frame. Leave the ink
    // path untouched and commit the group after its final pointerup instead.
    if (current.recorder.isActive) {
      return;
    }
    const elements = api.current?.getSceneElementsIncludingDeleted();
    if (!elements) {
      return;
    }
    const previous = current.history[current.history.length - 1];
    const same =
      elements.length === previous.length &&
      elements.every(
        (element, index) =>
          element.id === previous[index]?.id &&
          element.version === previous[index]?.version &&
          element.isDeleted === previous[index]?.isDeleted,
      );
    if (!same) {
      // Reuse immutable, unchanged marks. Only new/edited strokes are cloned,
      // after pointerup; history never retains 20 copies of the entire drawing.
      const previousById = new Map(
        previous.map((element) => [element.id, element]),
      );
      current.scene = elements.map((element) => {
        const saved = previousById.get(element.id);
        return saved &&
          saved.version === element.version &&
          saved.isDeleted === element.isDeleted
          ? saved
          : structuredClone(element);
      });
      current.history = [...current.history.slice(-19), current.scene];
      current.future = [];
    }
    update();
  }, [sessions, update]);

  const scheduleCommit = useCallback(() => {
    if (pendingCommit.current !== null) {
      cancelAnimationFrame(pendingCommit.current);
    }
    pendingCommit.current = requestAnimationFrame(commit);
  }, [commit]);

  useEffect(() => {
    const element = surface.current;
    if (!element) {
      return;
    }
    const current = sessions[mode];
    const controller = new InkInputController(
      element,
      current.recorder,
      current.input,
      pencilOnly,
      scheduleCommit,
    );
    return () => controller.dispose();
  }, [mode, pencilOnly, sessions, scheduleCommit]);

  useEffect(
    () => () => {
      if (pendingCommit.current !== null) {
        cancelAnimationFrame(pendingCommit.current);
      }
    },
    [],
  );

  const initialize = useCallback((instance: ExcalidrawImperativeAPI) => {
    api.current = instance;
  }, []);

  const lockView = useCallback(
    (scrollX: number, scrollY: number, zoom: AppState["zoom"]) => {
      if (
        changingView.current ||
        (scrollX === 0 && scrollY === 0 && zoom.value === 1)
      ) {
        return;
      }
      changingView.current = true;
      api.current?.updateScene({
        appState: {
          scrollX: 0,
          scrollY: 0,
          zoom: { value: 1 as AppState["zoom"]["value"] },
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      changingView.current = false;
    },
    [],
  );

  const changeMode = (next: InkMode) => {
    if (next === mode) {
      return;
    }
    session.input.reset("mode_switch", performance.now());
    session.recorder.interrupt();
    if (pendingCommit.current !== null) {
      cancelAnimationFrame(pendingCommit.current);
    }
    commit();
    api.current = null;
    modeRef.current = next;
    setMode(next);
    setTool("freedraw");
    setClearPending(false);
  };
  const changeTool = (next: typeof tool) => {
    setTool(next);
    api.current?.setActiveTool({ type: next });
  };
  const undo = (redo: boolean) => {
    const current = sessions[mode];
    if (redo) {
      const next = current.future.pop();
      if (!next) {
        return;
      }
      current.history.push(next);
    } else {
      if (current.history.length < 2) {
        return;
      }
      current.future.push(current.history.pop()!);
    }
    current.scene = current.history[current.history.length - 1];
    api.current?.updateScene({
      elements: structuredClone(current.scene),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    update();
  };
  const clear = () => {
    if (!clearPending) {
      setClearPending(true);
      return;
    }
    const current = sessions[mode];
    current.scene = [];
    current.history = [...current.history.slice(-19), []];
    current.future = [];
    api.current?.updateScene({
      elements: [],
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setClearPending(false);
    update();
  };
  const download = () => {
    commit();
    const payload = {
      schemaVersion: 2,
      experimentRevision: "palm-recovery-v2",
      exportedAt: new Date().toISOString(),
      environment: {
        ...captureCapabilities,
        userAgent: navigator.userAgent,
        pixelRatio: window.devicePixelRatio,
        canvas: {
          width: surface.current?.clientWidth,
          height: surface.current?.clientHeight,
        },
      },
      notes:
        "Browser timing proxies only, not physical pen-to-photon latency. Raw capture is bounded at 30000 samples per mode. No automatic upload or persistent storage.",
      modes: Object.fromEntries(
        Object.entries(sessions).map(([key, value]) => [
          key,
          {
            scene: value.scene,
            ratings: value.ratings,
            summary: value.recorder.summary(),
            inputDiagnostics: value.input.diagnostics(),
            rawPointerSamples: value.recorder.samples(),
            notebookHandlerMetrics: value.metrics,
          },
        ]),
      ),
    };
    const href = URL.createObjectURL(
      new Blob([JSON.stringify(payload)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `qudraw-ink-${Date.now()}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 5000);
  };

  return (
    <main className="ink-lab">
      <header className="lab-header">
        <div className="brand">
          <span className="brand-mark">q</span>
          <div>
            qudraw<small>필기 실험실</small>
          </div>
        </div>
        <div className="mode-switch" role="group" aria-label="필기 방식 비교">
          {(["classic", "notebook"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={mode === value}
              onClick={() => changeMode(value)}
            >
              <span>{value === "classic" ? "A" : "B"}</span>
              {modeNames[value]}
            </button>
          ))}
        </div>
        <button
          className="data-button"
          onClick={() => setPanelOpen(!panelOpen)}
          aria-expanded={panelOpen}
        >
          기록 · 느낌
        </button>
      </header>
      <section
        className="writing-zone"
        aria-label={`${modeNames[mode]} 연습장`}
      >
        <div className="paper-toolbar">
          <div className="exercise">
            <b>가나다 · 1 + 1 · ㄱ ㄴ ㄷ</b>
            <span>짧게 쓰고, 펜을 살짝 떼어 보세요.</span>
          </div>
          <div className="tools" role="group" aria-label="필기 도구">
            <button
              className={tool === "freedraw" ? "selected" : ""}
              onClick={() => changeTool("freedraw")}
              aria-pressed={tool === "freedraw"}
            >
              펜
            </button>
            <button
              className={tool === "eraser" ? "selected" : ""}
              onClick={() => changeTool("eraser")}
              aria-pressed={tool === "eraser"}
            >
              지우개
            </button>
            <button
              onClick={() => undo(false)}
              disabled={session.history.length < 2}
              aria-label="되돌리기"
            >
              ↶
            </button>
            <button
              onClick={() => undo(true)}
              disabled={!session.future.length}
              aria-label="다시 실행"
            >
              ↷
            </button>
            <button
              className={clearPending ? "danger" : ""}
              onClick={clear}
              onBlur={() => setClearPending(false)}
            >
              {clearPending ? "정말 지우기" : "비우기"}
            </button>
          </div>
        </div>
        <div
          className="ink-surface"
          ref={surface}
          onContextMenuCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDownCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDoubleClickCapture={(event) => event.stopPropagation()}
          onDropCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Excalidraw
            key={mode}
            excalidrawAPI={initialize}
            handwritingMode={mode}
            notebookTouchEnabled={!pencilOnly}
            initialData={initialData}
            onPointerUp={scheduleCommit}
            onScrollChange={lockView}
            onHandwritingMetrics={(metrics) => {
              const list = sessions[modeRef.current].metrics;
              if (list.length < 2000) {
                list.push(metrics);
              }
            }}
            UIOptions={uiOptions}
            langCode="ko-KR"
            theme="light"
            zenModeEnabled
            handleKeyboardGlobally={false}
            detectScroll={false}
            aiEnabled={false}
            onPaste={() => false}
            onLinkOpen={(_, event) => event.preventDefault()}
          />
          <div className="paper-watermark" aria-hidden="true">
            {mode === "notebook"
              ? "노트 필기 · 보정 최소화"
              : "기존 필기 · 원본 Excalidraw"}
          </div>
        </div>
        <footer className="paper-footer">
          <label>
            <input
              type="checkbox"
              checked={pencilOnly}
              onChange={(event) => setPencilOnly(event.target.checked)}
            />
            Pencil만 쓰기<span>손바닥 터치 방지</span>
          </label>
          <span>각 방식의 필기는 따로 유지돼요. 새로고침하면 사라져요.</span>
        </footer>
      </section>
      {panelOpen && (
        <>
          <button
            className="panel-backdrop"
            aria-label="기록 닫기"
            onClick={() => setPanelOpen(false)}
          />
          <aside className="results-panel" aria-label="필기 기록과 느낌">
            <div className="panel-heading">
              <div>
                <small>
                  {mode === "classic" ? "A" : "B"} · {modeNames[mode]}
                </small>
                <h1>손끝의 느낌을 알려 주세요</h1>
              </div>
              <button
                aria-label="기록 닫기"
                onClick={() => setPanelOpen(false)}
              >
                ×
              </button>
            </div>
            <p>
              같은 글자를 두 방식으로 써 보세요. 숫자는 브라우저의 입력 처리
              기록이고, 실제 느낌은 직접 선택해 주세요.
            </p>
            <div className="ratings">
              {ratingLabels.map(([key, label]) => (
                <fieldset key={key}>
                  <legend>{label}</legend>
                  <div className="rating-scale">
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <button
                        key={rating}
                        aria-pressed={session.ratings[key] === rating}
                        onClick={() => {
                          session.ratings[key] = rating;
                          update();
                        }}
                      >
                        {rating}
                      </button>
                    ))}
                  </div>
                  <div className="rating-ends">
                    <span>1 전혀 아니요</span>
                    <span>5 아주 많이요</span>
                  </div>
                </fieldset>
              ))}
            </div>
            <section className="measurements">
              <h2>입력 기록</h2>
              <small>palm-recovery-v2</small>
              <p>
                좌표 묶음 API:{" "}
                {captureCapabilities.coalescedEventsAvailable
                  ? "사용 가능"
                  : "미지원"}{" "}
                · 보안 연결:{" "}
                {captureCapabilities.secureContext ? "예" : "아니요"}
              </p>
              <dl>
                <div>
                  <dt>끝낸 획</dt>
                  <dd>{summary?.strokesCompleted}개</dd>
                </div>
                <div>
                  <dt>브라우저 취소 / 중단</dt>
                  <dd>
                    {summary?.strokesCanceled} / {summary?.strokesInterrupted}
                  </dd>
                </div>
                <div>
                  <dt>기록한 좌표</dt>
                  <dd>{summary?.capturedSamples.toLocaleString()}개</dd>
                </div>
                <div>
                  <dt>입력 이벤트 도착 P95</dt>
                  <dd>{formatMs(summary?.eventAgeP95Ms ?? null)}</dd>
                </div>
                <div>
                  <dt>입력 표본 간격 P95</dt>
                  <dd>{formatMs(summary?.inputIntervalP95Ms ?? null)}</dd>
                </div>
                <div>
                  <dt>프레임 간격 P95</dt>
                  <dd>
                    {formatMs(summary?.animationFrameIntervalP95Ms ?? null)}
                  </dd>
                </div>
              </dl>
              <p>
                화면에 잉크가 실제로 보이기까지의 시간은 아닙니다. 프레임 간격은
                화면 주사율에도 영향을 받아요.
              </p>
              {!!summary?.droppedSamples && (
                <p>
                  오래된 좌표 {summary.droppedSamples.toLocaleString()}개가 기록
                  한도로 생략됐어요.
                </p>
              )}
            </section>
            <button className="export-button" onClick={download}>
              두 방식의 기록 내려받기 ↓
            </button>
            <p className="privacy-note">
              필기와 측정값은 이 페이지 메모리에만 있어요. 이 버튼을 눌렀을 때만
              JSON 파일로 저장하며, 서버로 보내지 않아요.
            </p>
          </aside>
        </>
      )}
    </main>
  );
}
