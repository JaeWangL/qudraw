import { describe, expect, it } from "vitest";
import { InkInputArbiter } from "./InkInputArbiter";
const contact = (pointerId: number, pointerType = "pen") => ({
  pointerId,
  pointerType,
  button: 0,
  buttons: 1,
  pressure: 0.5,
});

describe("InkInputArbiter", () => {
  it("always admits a fresh primary pen contact after a missing end with another ID", () => {
    const input = new InkInputArbiter();
    input.down(contact(1), 0, true);
    expect(input.down(contact(7), 20, true)).toEqual({
      accepted: true,
      replaced: true,
    });
    expect(input.end(contact(1), "pointerup", 21)).toEqual({
      accepted: false,
      blocked: true,
    });
    expect(input.activePointerId).toBe(7);
    input.end(contact(7), "pointerup", 30);
    expect(input.diagnostics()).toMatchObject({
      admittedDown: { pen: 2 },
      blockedDown: { pen: 0 },
      recoveries: 1,
      active: null,
    });
  });

  it("gives pen priority over an opt-in finger and suppresses its late end", () => {
    const input = new InkInputArbiter();
    expect(input.down(contact(1, "touch"), 0, false).accepted).toBe(true);
    expect(input.down(contact(2), 1, false).accepted).toBe(true);
    expect(input.down(contact(3, "touch"), 2, false).accepted).toBe(false);
    expect(input.end(contact(1, "touch"), "pointerup", 3).blocked).toBe(true);
    expect(input.activePointerId).toBe(2);
    input.end(contact(2), "pointerup", 4);
    expect(input.down(contact(4, "touch"), 5, false).accepted).toBe(false);
    expect(input.down(contact(5, "touch"), 400, false).accepted).toBe(true);
  });

  it("never lets a palm contact own input in Pencil-only mode", () => {
    const input = new InkInputArbiter();
    expect(input.down(contact(1, "touch"), 0, true).accepted).toBe(false);
    expect(input.activePointerId).toBeNull();
    expect(input.down(contact(2), 1, true).accepted).toBe(true);
  });

  it("records contact moves without a down but never synthesizes a stroke", () => {
    const input = new InkInputArbiter();
    expect(input.move(contact(8), 5).record).toBe(false);
    input.move({ ...contact(8), buttons: 0, pressure: 0 }, 6);
    expect(input.diagnostics().orphanPenContactMoves).toBe(1);
    expect(input.activePointerId).toBeNull();
  });

  it("recovers hover, cancellation and page lifecycle state", () => {
    const input = new InkInputArbiter();
    input.down(contact(1), 0, true);
    expect(
      input.move({ ...contact(1), buttons: 0, pressure: 0 }, 10).interrupted,
    ).toBe(true);
    input.down(contact(2), 11, true);
    input.end(contact(2), "pointercancel", 12);
    input.down(contact(3), 13, true);
    input.reset("page_hidden", 14);
    expect(input.down(contact(4), 15, true).accepted).toBe(true);
    expect(input.diagnostics().lifecycleResets).toBe(1);
  });

  it("bounds decision memory while retaining cumulative counters", () => {
    const input = new InkInputArbiter();
    for (let id = 0; id < 500; id++) {
      input.down(contact(id), id, true);
    }
    const result = input.diagnostics();
    expect(result.receivedDown.pen).toBe(500);
    expect(result.recentDecisions).toHaveLength(256);
    expect(result.omittedDecisionRecords).toBe(244);
    expect(result.recentDecisions[0].pointerId).toBe(244);
  });
});

describe("InkInputArbiter contact lifetime boundaries", () => {
  it("ignores delayed previous-lifetime ends when Safari reuses a pointer ID", () => {
    const input = new InkInputArbiter();
    input.down({ ...contact(1), timeStamp: 10 }, 10, true);
    input.down({ ...contact(1), timeStamp: 50 }, 50, true);
    expect(
      input.end({ ...contact(1), timeStamp: 20 }, "pointerup", 51),
    ).toEqual({ accepted: false, blocked: true });
    expect(input.activePointerId).toBe(1);
    expect(input.move({ ...contact(1), timeStamp: 30 }, 52).record).toBe(false);
    expect(
      input.end({ ...contact(1), timeStamp: 60 }, "pointercancel", 60).accepted,
    ).toBe(true);
    expect(input.diagnostics().staleBoundaryEvents).toBe(1);
  });

  it("keeps the 300 ms post-pen palm guard separate from optional finger writing", () => {
    const input = new InkInputArbiter();
    input.down(contact(1), 0, false);
    input.end(contact(1), "pointerup", 10);
    expect(input.down(contact(2, "touch"), 309, false).accepted).toBe(false);
    expect(input.down(contact(3, "touch"), 310, false).accepted).toBe(true);
    expect(input.move(contact(3, "touch"), 311).record).toBe(true);
    expect(input.end(contact(3, "touch"), "pointerup", 312).accepted).toBe(
      true,
    );
    expect(input.down(contact(4, "touch"), 313, true).accepted).toBe(false);
  });
});
