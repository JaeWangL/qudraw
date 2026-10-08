import type { InkInputArbiter } from "./InkInputArbiter";
import type { InkRecorder } from "./InkRecorder";

// Match the upstream iOS test, including desktop-mode iPadOS. Evaluated per
// controller so environment/lifecycle tests exercise the same runtime branch.
const needsApplePencilScribbleGuard = () =>
  /iPad|iPhone|iPod/.test(navigator.platform) ||
  (navigator.userAgent.includes("Mac") &&
    (navigator.maxTouchPoints > 1 || "ontouchend" in document));

/** Native capture guards gestures before React, without gating ink on a recorder. */
export class InkInputController {
  private frame: number | null = null;
  private readonly suppressScribble = needsApplePencilScribbleGuard();
  private removers: Array<() => void> = [];

  constructor(
    private readonly element: HTMLElement,
    private readonly recorder: InkRecorder,
    private readonly arbiter: InkInputArbiter,
    private readonly pencilOnly: boolean,
    private readonly onBoundary: () => void,
  ) {
    this.listen(element, "pointerdown", this.down);
    this.listen(element, "pointermove", this.move);
    this.listen(element, "lostpointercapture", this.end);
    this.listen(window, "pointerup", this.end);
    this.listen(window, "pointercancel", this.end);
    this.listen(window, "blur", this.blur);
    this.listen(window, "pagehide", this.pagehide);
    this.listen(document, "visibilitychange", this.visibility);
    this.listen(element, "wheel", this.prevent);
    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach((type) =>
      this.listen(element, type, this.legacyTouch),
    );
    ["gesturestart", "gesturechange", "gestureend"].forEach((type) =>
      this.listen(element, type, this.prevent),
    );
  }

  private listen(
    target: EventTarget,
    type: string,
    callback: (event: never) => void,
  ) {
    const listener = callback as EventListener;
    target.addEventListener(type, listener, { capture: true, passive: false });
    this.removers.push(() => target.removeEventListener(type, listener, true));
  }

  private stopFrame = () => {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
    }
    this.frame = null;
  };

  private animate = (time: number) => {
    this.recorder.frame(time);
    this.frame = this.recorder.isActive
      ? requestAnimationFrame(this.animate)
      : null;
  };

  private prevent = (event: Event) => {
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
  };

  private down = (event: PointerEvent) => {
    const now = performance.now();
    const decision = this.arbiter.down(event, now, this.pencilOnly);
    if (!decision.accepted) {
      this.prevent(event);
      return;
    }
    // Observation must never veto a valid new pen contact, even when its old
    // pointerup was lost or Safari assigned the next contact a different ID.
    this.recorder.record(
      "down",
      event,
      now,
      false,
      this.element.getBoundingClientRect(),
    );
    this.stopFrame();
    this.frame = requestAnimationFrame(this.animate);
  };

  private move = (event: PointerEvent) => {
    const now = performance.now();
    const decision = this.arbiter.move(event, now);
    if (decision.block) {
      this.prevent(event);
    }
    if (decision.interrupted) {
      this.recorder.interrupt();
      this.stopFrame();
      this.onBoundary();
    }
    if (!decision.record) {
      return;
    }
    let samples: PointerEvent[] = [];
    try {
      samples = event.getCoalescedEvents?.() ?? [];
    } catch {
      this.arbiter.noteCoalescedReadFailure();
    }
    for (const sample of samples) {
      this.recorder.record("move", sample, now, true);
    }
    const last = samples[samples.length - 1];
    if (
      !last ||
      last.timeStamp !== event.timeStamp ||
      last.clientX !== event.clientX ||
      last.clientY !== event.clientY ||
      last.pressure !== event.pressure
    ) {
      this.recorder.record("move", event, now);
    }
  };

  private end = (event: PointerEvent) => {
    if (
      event.type === "lostpointercapture" &&
      event.target instanceof Element &&
      event.target.hasPointerCapture?.(event.pointerId)
    ) {
      this.arbiter.ignoreBoundary(
        event,
        event.type,
        performance.now(),
        "lost_capture_after_recapture",
      );
      return;
    }
    const decision = this.arbiter.end(event, event.type, performance.now());
    if (decision.blocked) {
      this.prevent(event);
    }
    if (!decision.accepted) {
      return;
    }
    this.recorder.record(
      event.type === "pointerup"
        ? "up"
        : event.type === "lostpointercapture"
        ? "lostcapture"
        : "cancel",
      event,
      performance.now(),
    );
    this.stopFrame();
    this.onBoundary();
  };

  private interrupt(reason: "blur" | "page_hidden" | "pagehide" | "unmount") {
    this.arbiter.reset(reason, performance.now());
    this.recorder.interrupt();
    this.stopFrame();
    if (reason !== "unmount") {
      this.onBoundary();
    }
  }
  private blur = () => this.interrupt("blur");
  private pagehide = () => this.interrupt("pagehide");
  private visibility = () => {
    if (document.hidden) {
      this.interrupt("page_hidden");
    }
  };

  private legacyTouch = (event: TouchEvent) => {
    this.arbiter.noteLegacyTouch();
    // Preserve Excalidraw's Apple Pencil Scribble fix before isolating the
    // legacy gesture handler. It applies to the FIRST touchstart too, including
    // stylus/unknown touches: https://github.com/excalidraw/excalidraw/pull/4705
    if (
      event.type === "touchstart" &&
      this.suppressScribble &&
      event.cancelable
    ) {
      event.preventDefault();
    }
    // TouchEvents are separate from PointerEvents on Safari. Isolate legacy
    // selection/gesture state from the admitted ink-pointer lifetime, including
    // after a palm pointerdown has already been rejected.
    event.stopPropagation();
    const changed = Array.from(event.changedTouches ?? []);
    if (
      event.type === "touchmove" &&
      changed.length &&
      changed.every(
        (touch) =>
          (touch as Touch & { touchType?: string }).touchType === "direct",
      ) &&
      event.cancelable
    ) {
      event.preventDefault();
    }
  };

  dispose() {
    this.removers.forEach((remove) => remove());
    this.removers = [];
    this.interrupt("unmount");
  }
}
