import type { StrokeOptions } from "perfect-freehand";
import type { ExcalidrawFreeDrawElement } from "../element/types";

/** iPadOS may advertise a desktop Macintosh user agent. */
export const isAppleTouchDevice = ({
  userAgent,
  platform,
  maxTouchPoints,
}: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">) =>
  /iPad|iPhone|iPod/.test(userAgent) ||
  ((platform === "MacIntel" || /Macintosh/.test(userAgent)) &&
    maxTouchPoints > 1);

/** Saved with each mark so reloading/exporting never depends on the current tool. */
export type NotebookInkProfile = {
  version: 1;
  profile: "notebook";
  completed: boolean;
};

export type HandwritingMetrics = {
  mode: "notebook";
  elementId: string;
  pointerType: string;
  durationMs: number;
  moveEvents: number;
  coalescedSamples: number;
  acceptedSamples: number;
  /** Browser event delivery/handler proxies, NOT physical pen-to-photon latency. */
  maxEventAgeMs: number;
  maxHandlerMs: number;
};

export const notebookInkProfile = (completed = false): NotebookInkProfile => ({
  version: 1,
  profile: "notebook",
  completed,
});

export const getNotebookInkProfile = (
  element: Pick<ExcalidrawFreeDrawElement, "customData">,
): NotebookInkProfile | null => {
  const profile = element.customData?.qudrawInk;
  return profile?.version === 1 &&
    profile.profile === "notebook" &&
    typeof profile.completed === "boolean"
    ? profile
    : null;
};

export const notebookStrokeOptions = (
  element: Pick<ExcalidrawFreeDrawElement, "strokeWidth" | "customData">,
): StrokeOptions => ({
  size: element.strokeWidth * 4.25,
  simulatePressure: false,
  thinning: 0.15,
  smoothing: 0,
  streamline: 0,
  easing: (pressure) => pressure,
  last: !!getNotebookInkProfile(element)?.completed,
});

/** A lifetime belongs to exactly one pointerdown, never to the active tool. */
export class NotebookPointerSession {
  closed = false;
  lastEvent: PointerEvent;
  private readonly startedEventTime: number;

  constructor(
    readonly pointerId: number,
    readonly pointerType: string,
    readonly startEvent: PointerEvent,
  ) {
    this.lastEvent = startEvent;
    this.startedEventTime = startEvent.timeStamp;
  }

  accepts(event: PointerEvent): boolean {
    return (
      !this.closed &&
      event.pointerId === this.pointerId &&
      event.timeStamp >= this.startedEventTime
    );
  }

  close(): void {
    this.closed = true;
  }
}

export class NotebookStrokeSession extends NotebookPointerSession {
  private moveEvents = 0;
  private coalescedSamples = 0;
  private acceptedSamples = 1;
  private maxEventAgeMs = 0;
  private maxHandlerMs = 0;
  private readonly startedAt = performance.now();

  constructor(
    readonly elementId: string,
    pointerId: number,
    pointerType: string,
    event: PointerEvent,
  ) {
    super(pointerId, pointerType, event);
  }

  samples(event: PointerEvent): PointerEvent[] {
    if (!this.accepts(event)) {
      return [];
    }
    let coalesced: PointerEvent[] = [];
    try {
      coalesced = event.getCoalescedEvents?.() ?? [];
    } catch {
      // Older browser shims may expose an unusable method. The outer sample
      // still represents valid ink and must not abort stroke cleanup.
    }
    this.moveEvents++;
    this.coalescedSamples += coalesced.length;
    // Coalesced events are ordered. The outer event can carry a newer endpoint;
    // coordinate+pressure deduplication happens when appending to the element.
    const samples = [...coalesced, event].filter(
      (sample) =>
        this.accepts(sample) && sample.timeStamp >= this.lastEvent.timeStamp,
    );
    if (samples.length) {
      this.lastEvent = samples[samples.length - 1];
    }
    const age = performance.now() - event.timeStamp;
    if (age >= 0 && age < 60_000) {
      this.maxEventAgeMs = Math.max(this.maxEventAgeMs, age);
    }
    return samples;
  }

  recordHandler(accepted: number, elapsedMs: number) {
    this.acceptedSamples += accepted;
    this.maxHandlerMs = Math.max(this.maxHandlerMs, elapsedMs);
  }

  close(): HandwritingMetrics | null {
    if (this.closed) {
      return null;
    }
    this.closed = true;
    return {
      mode: "notebook",
      elementId: this.elementId,
      pointerType: this.pointerType,
      durationMs: performance.now() - this.startedAt,
      moveEvents: this.moveEvents,
      coalescedSamples: this.coalescedSamples,
      acceptedSamples: this.acceptedSamples,
      maxEventAgeMs: this.maxEventAgeMs,
      maxHandlerMs: this.maxHandlerMs,
    };
  }
}
