import { describe, expect, it } from "vitest";
import { InkRecorder } from "./InkRecorder";

const sample = (pointerId: number, timeStamp: number) => ({
  pointerId,
  pointerType: "pen",
  clientX: 30,
  clientY: 40,
  pressure: 0.4,
  timeStamp,
});

describe("InkRecorder", () => {
  it("keeps separate boundaries and ignores moves from unadmitted pointers", () => {
    const recorder = new InkRecorder();
    recorder.record("down", sample(1, 10), 11, false, { left: 10, top: 20 });
    expect(recorder.record("move", sample(2, 12), 13)).toBe(false);
    recorder.record("up", sample(1, 20), 21);
    expect(recorder.record("move", sample(1, 22), 23)).toBe(false);
    recorder.record("down", sample(1, 30), 31);
    recorder.record("up", sample(1, 40), 41);
    expect(
      recorder.samples().map(({ stroke, phase }) => [stroke, phase]),
    ).toEqual([
      [1, "down"],
      [1, "up"],
      [2, "down"],
      [2, "up"],
    ]);
    expect(recorder.samples()[0]).toMatchObject({
      x: 20,
      y: 20,
      pressure: 0.4,
    });
    expect(recorder.summary().strokesCompleted).toBe(2);
  });

  it("recovers a missing up even when Safari gives the new pen contact a different ID", () => {
    const recorder = new InkRecorder();
    recorder.record("down", sample(1, 1), 2);
    recorder.record("move", sample(1, 2), 3);
    recorder.record("down", sample(2, 10), 11);
    recorder.record("up", sample(2, 11), 12);
    expect(recorder.samples().map(({ stroke }) => stroke)).toEqual([
      1, 1, 2, 2,
    ]);
    expect(recorder.summary()).toMatchObject({
      strokesCompleted: 1,
      strokesInterrupted: 1,
    });
  });

  it("bounds capture memory and discloses truncated data in chronological order", () => {
    const recorder = new InkRecorder(3);
    recorder.record("down", sample(1, 1), 2);
    recorder.record("move", sample(1, 2), 3, true);
    recorder.record("move", sample(1, 3), 4);
    recorder.record("up", sample(1, 4), 5);
    expect(recorder.samples().map(({ sequence }) => sequence)).toEqual([
      2, 3, 4,
    ]);
    expect(recorder.summary()).toMatchObject({
      capturedSamples: 3,
      droppedSamples: 1,
      coalescedSamples: 1,
      eventAgeP95Ms: 1,
    });
  });

  it("separates cancellation and interruption from completed strokes", () => {
    const recorder = new InkRecorder();
    recorder.record("down", sample(1, 1), 2);
    recorder.record("cancel", sample(1, 4), 5);
    recorder.record("down", sample(1, 10), 11);
    recorder.interrupt();
    expect(recorder.summary()).toMatchObject({
      strokesCompleted: 0,
      strokesCanceled: 1,
      strokesInterrupted: 1,
    });
  });
});
