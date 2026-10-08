import { afterEach, describe, expect, it, vi } from "vitest";
import { InkInputController } from "./InkInputController";
import { InkInputArbiter } from "./InkInputArbiter";
import { InkRecorder } from "./InkRecorder";

const pointer = (
  type: string,
  id: number,
  kind = "pen",
  overrides: Partial<PointerEvent> = {},
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const fields = {
    pointerId: id,
    pointerType: kind,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    pressure: type === "pointerup" ? 0 : 0.5,
    clientX: 50,
    clientY: 60,
    ...overrides,
  };
  Object.entries(fields).forEach(([key, value]) =>
    Object.defineProperty(event, key, { value }),
  );
  return event;
};
const touch = (type: string, touchType?: string) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "changedTouches", { value: [{ touchType }] });
  return event;
};
const controllers: InkInputController[] = [];
function setup(pencilOnly = true) {
  const frame = document.createElement("div");
  const canvas = document.createElement("canvas");
  frame.appendChild(canvas);
  document.body.appendChild(frame);
  const recorder = new InkRecorder();
  const input = new InkInputArbiter();
  const boundary = vi.fn();
  const controller = new InkInputController(
    frame,
    recorder,
    input,
    pencilOnly,
    boundary,
  );
  controllers.push(controller);
  const delivered = vi.fn();
  canvas.addEventListener("pointerdown", delivered);
  return { frame, canvas, recorder, input, controller, boundary, delivered };
}
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("InkInputController mixed native event sequences", () => {
  it("does not freeze a new pen ID after missed up, even with palm contacts in between", () => {
    const { canvas, delivered, recorder, input } = setup();
    canvas.dispatchEvent(pointer("pointerdown", 1));
    canvas.dispatchEvent(pointer("pointermove", 1));
    canvas.dispatchEvent(pointer("pointerdown", 90, "touch"));
    canvas.dispatchEvent(touch("touchstart", "direct"));
    canvas.dispatchEvent(pointer("pointerdown", 2));
    canvas.dispatchEvent(pointer("pointerup", 1));
    canvas.dispatchEvent(pointer("pointermove", 2));
    canvas.dispatchEvent(pointer("pointerup", 2));
    expect(delivered).toHaveBeenCalledTimes(2);
    expect(recorder.summary()).toMatchObject({
      strokesStarted: 2,
      strokesCompleted: 1,
      strokesInterrupted: 1,
      activePointer: null,
    });
    expect(input.diagnostics()).toMatchObject({
      admittedDown: { pen: 2 },
      blockedDown: { pen: 0, touch: 1 },
    });
  });

  it("admits Pencil after an opt-in finger and blocks the old finger end", () => {
    const { canvas, delivered, recorder } = setup(false);
    canvas.dispatchEvent(pointer("pointerdown", 10, "touch"));
    canvas.dispatchEvent(pointer("pointerdown", 20));
    canvas.dispatchEvent(pointer("pointerup", 10, "touch"));
    expect(recorder.activePointerId).toBe(20);
    canvas.dispatchEvent(pointer("pointerup", 20));
    expect(delivered).toHaveBeenCalledTimes(2);
    expect(recorder.summary().strokesCompleted).toBe(1);
  });

  it("isolates legacy double-tap and pinch events on non-iOS without canceling touchstart", () => {
    const { canvas, delivered } = setup();
    const engineTouch = vi.fn();
    canvas.addEventListener("touchstart", engineTouch);
    canvas.addEventListener("touchmove", engineTouch);
    const stylusStart = touch("touchstart", "stylus");
    canvas.dispatchEvent(stylusStart);
    const unknownStart = touch("touchstart");
    canvas.dispatchEvent(unknownStart);
    canvas.dispatchEvent(touch("touchstart", "direct"));
    canvas.dispatchEvent(touch("touchstart", "direct"));
    canvas.dispatchEvent(touch("touchmove", "direct"));
    canvas.dispatchEvent(pointer("pointerdown", 1));
    expect(stylusStart.defaultPrevented).toBe(false);
    expect(unknownStart.defaultPrevented).toBe(false);
    expect(engineTouch).not.toHaveBeenCalled();
    expect(delivered).toHaveBeenCalledOnce();
  });

  it.each(["pointercancel", "lostpointercapture"])(
    "recovers after %s and admits the next pen",
    (type) => {
      const { canvas, recorder, delivered } = setup();
      canvas.dispatchEvent(pointer("pointerdown", 1));
      canvas.dispatchEvent(pointer(type, 1));
      canvas.dispatchEvent(pointer("pointerdown", 2));
      canvas.dispatchEvent(pointer("pointerup", 2));
      expect(delivered).toHaveBeenCalledTimes(2);
      expect(recorder.summary()).toMatchObject({
        strokesCanceled: 1,
        strokesCompleted: 1,
      });
    },
  );

  it.each(["blur", "pagehide", "visibilitychange"])(
    "clears observational ownership on %s",
    (type) => {
      const { canvas, recorder, delivered } = setup();
      canvas.dispatchEvent(pointer("pointerdown", 1));
      if (type === "visibilitychange") {
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        document.dispatchEvent(new Event(type));
      } else {
        window.dispatchEvent(new Event(type));
      }
      canvas.dispatchEvent(pointer("pointerdown", 2));
      canvas.dispatchEvent(pointer("pointerup", 2));
      expect(delivered).toHaveBeenCalledTimes(2);
      expect(recorder.summary()).toMatchObject({
        strokesInterrupted: 1,
        strokesCompleted: 1,
      });
    },
  );

  it("cancels the frame probe on replacement, cancellation and unmount", () => {
    const callbacks = new Set<number>();
    let next = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => {
        const id = ++next;
        callbacks.add(id);
        return id;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => callbacks.delete(id)),
    );
    const { canvas, controller } = setup();
    canvas.dispatchEvent(pointer("pointerdown", 1));
    canvas.dispatchEvent(pointer("pointerdown", 2));
    expect(callbacks.size).toBe(1);
    canvas.dispatchEvent(pointer("pointercancel", 2));
    expect(callbacks.size).toBe(0);
    canvas.dispatchEvent(pointer("pointerdown", 3));
    controller.dispose();
    expect(callbacks.size).toBe(0);
  });
});

describe("InkInputController recovery diagnostics", () => {
  it("does not end a recaptured pointer on a delayed lostcapture notification", () => {
    const { canvas, recorder } = setup();
    canvas.dispatchEvent(pointer("pointerdown", 1));
    Object.defineProperty(canvas, "hasPointerCapture", {
      value: () => true,
      configurable: true,
    });
    canvas.dispatchEvent(pointer("lostpointercapture", 1));
    expect(recorder.activePointerId).toBe(1);
    Object.defineProperty(canvas, "hasPointerCapture", {
      value: () => false,
      configurable: true,
    });
    canvas.dispatchEvent(pointer("lostpointercapture", 1));
    expect(recorder.activePointerId).toBeNull();
  });

  it("counts missing downs and falls back safely when coalesced sampling throws", () => {
    const { canvas, recorder, input } = setup();
    canvas.dispatchEvent(pointer("pointermove", 1));
    canvas.dispatchEvent(
      pointer("pointermove", 1, "pen", { buttons: 0, pressure: 0 }),
    );
    canvas.dispatchEvent(pointer("pointerdown", 2));
    canvas.dispatchEvent(
      pointer("pointermove", 2, "pen", {
        getCoalescedEvents: () => {
          throw new Error("unavailable");
        },
      }),
    );
    canvas.dispatchEvent(pointer("pointerup", 2));
    expect(input.diagnostics()).toMatchObject({
      orphanPenContactMoves: 1,
      coalescedReadFailures: 1,
    });
    expect(recorder.samples().map(({ phase }) => phase)).toEqual([
      "down",
      "move",
      "up",
    ]);
  });
});

describe("InkInputController Apple Pencil Scribble guard", () => {
  it.each([
    {
      platform: "iPad",
      userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
      maxTouchPoints: 5,
    },
    {
      platform: "MacIntel",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Safari",
      maxTouchPoints: 5,
    },
  ])(
    "preserves first-touch default prevention on $platform before legacy isolation",
    (environment) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(
        environment.platform,
      );
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
        environment.userAgent,
      );
      Object.defineProperty(navigator, "maxTouchPoints", {
        configurable: true,
        value: environment.maxTouchPoints,
      });
      const { canvas, delivered } = setup();
      const engineLegacyHandler = vi.fn();
      canvas.addEventListener("touchstart", engineLegacyHandler);
      for (const kind of ["stylus", undefined, "direct"]) {
        const event = touch("touchstart", kind);
        canvas.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
      canvas.dispatchEvent(pointer("pointerdown", 1));
      expect(delivered).toHaveBeenCalledOnce();
      expect(engineLegacyHandler).not.toHaveBeenCalled();
      Reflect.deleteProperty(navigator, "maxTouchPoints");
    },
  );
});
