export type InkMode = "classic" | "notebook";
export type InputPhase = "down" | "move" | "up" | "cancel" | "lostcapture";
export interface InkSample {
  sequence: number;
  stroke: number;
  phase: InputPhase;
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  pressure: number;
  timestamp: number;
  receivedAt: number;
  coalesced: boolean;
}

export interface PointerSample {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  pressure: number;
  timeStamp: number;
}

const percentile = (values: number[], ratio: number) => {
  if (!values.length) {
    return null;
  }
  values.sort((a, b) => a - b);
  return values[
    Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)
  ];
};

/** Bounded observation of already-admitted input. Every down starts a new
 * lifetime; the recorder has no authority to reject a contact or gate drawing.
 * No serialization, state updates or storage on move.
 */
export class InkRecorder {
  private readonly buffer: Array<InkSample | undefined>;
  private cursor = 0;
  private count = 0;
  private sequence = 0;
  private stroke = 0;
  private activePointer: number | null = null;
  private origin = { left: 0, top: 0 };
  private frameIntervals: number[] = [];
  private lastFrame: number | null = null;
  private ended = 0;
  private canceled = 0;
  private interrupted = 0;

  constructor(private readonly capacity = 30_000) {
    if (capacity < 2) {
      throw new Error("Capture capacity must be at least two");
    }
    this.buffer = new Array(capacity);
  }

  get isActive() {
    return this.activePointer !== null;
  }

  get activePointerId() {
    return this.activePointer;
  }

  record(
    phase: InputPhase,
    event: PointerSample,
    receivedAt: number,
    coalesced = false,
    origin?: { left: number; top: number },
  ) {
    if (phase === "down") {
      if (this.activePointer !== null) {
        this.interrupt();
      }
      this.activePointer = event.pointerId;
      this.stroke += 1;
      this.origin = origin ?? { left: 0, top: 0 };
      this.lastFrame = null;
    }
    if (this.activePointer !== event.pointerId) {
      return false;
    }
    this.buffer[this.cursor] = {
      sequence: ++this.sequence,
      stroke: this.stroke,
      phase,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX - this.origin.left,
      y: event.clientY - this.origin.top,
      pressure: event.pressure,
      timestamp: event.timeStamp,
      receivedAt,
      coalesced,
    };
    this.cursor = (this.cursor + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    if (phase === "up" || phase === "cancel" || phase === "lostcapture") {
      this.activePointer = null;
      this.lastFrame = null;
      if (phase === "up") {
        this.ended += 1;
      } else {
        this.canceled += 1;
      }
    }
    return true;
  }

  interrupt() {
    if (this.activePointer !== null) {
      this.interrupted += 1;
    }
    this.activePointer = null;
    this.lastFrame = null;
  }

  frame(time: number) {
    if (!this.isActive) {
      return;
    }
    if (this.lastFrame !== null && this.frameIntervals.length < 10_000) {
      this.frameIntervals.push(time - this.lastFrame);
    }
    this.lastFrame = time;
  }

  samples(): InkSample[] {
    const start = (this.cursor - this.count + this.capacity) % this.capacity;
    return Array.from(
      { length: this.count },
      (_, index) => this.buffer[(start + index) % this.capacity]!,
    );
  }

  summary() {
    const samples = this.samples();
    const ages = samples.map((sample) =>
      Math.max(0, sample.receivedAt - sample.timestamp),
    );
    const intervals: number[] = [];
    samples.forEach((sample, index) => {
      const previous = samples[index - 1];
      if (previous && previous.stroke === sample.stroke) {
        intervals.push(Math.max(0, sample.timestamp - previous.timestamp));
      }
    });
    return {
      strokesStarted: this.stroke,
      strokesCompleted: this.ended,
      strokesCanceled: this.canceled,
      strokesInterrupted: this.interrupted,
      capturedSamples: samples.length,
      droppedSamples: Math.max(0, this.sequence - this.count),
      coalescedSamples: samples.filter((sample) => sample.coalesced).length,
      eventAgeP95Ms: percentile(ages, 0.95),
      inputIntervalP95Ms: percentile(intervals, 0.95),
      animationFrameIntervalP95Ms: percentile([...this.frameIntervals], 0.95),
      activePointer: this.activePointer,
    };
  }
}
