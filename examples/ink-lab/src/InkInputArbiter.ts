export type PointerKind = "pen" | "touch" | "mouse" | "other";
export interface ContactEvent {
  pointerId: number;
  pointerType: string;
  button: number;
  buttons: number;
  pressure: number;
  timeStamp?: number;
}
interface Contact {
  pointerId: number;
  kind: PointerKind;
  startedAtEventTimestamp: number | null;
}
type ResetReason =
  | "blur"
  | "page_hidden"
  | "pagehide"
  | "unmount"
  | "mode_switch";
export interface InputDecisionRecord {
  time: number;
  event: string;
  pointerId: number | null;
  pointerType: PointerKind | null;
  accepted: boolean;
  reason: string;
}
const kindOf = (value: string): PointerKind =>
  value === "pen" || value === "touch" || value === "mouse" ? value : "other";
const freshCounts = () => ({ pen: 0, touch: 0, mouse: 0, other: 0 });

/** Input ownership is independent from observation. A fresh pen down always wins. */
export class InkInputArbiter {
  private active: Contact | null = null;
  private lastPenEnd = -Infinity;
  private readonly decisions: Array<InputDecisionRecord | undefined> =
    new Array(256);
  private decisionCursor = 0;
  private decisionCount = 0;
  private decisionTotal = 0;
  private receivedDown = freshCounts();
  private admittedDown = freshCounts();
  private blockedDown = freshCounts();
  private blockedReasons: Record<string, number> = {};
  private recoveries = 0;
  private orphanPenContactMoves = 0;
  private palmMovesBlocked = 0;
  private legacyTouchEvents = 0;
  private resets = 0;
  private coalescedReadFailures = 0;
  private staleBoundaryEvents = 0;
  private blockedContacts = new Set<number>();

  get activePointerId() {
    return this.active?.pointerId ?? null;
  }

  down(event: ContactEvent, time: number, pencilOnly: boolean) {
    const kind = kindOf(event.pointerType);
    this.receivedDown[kind]++;
    let reason: string | null = null;
    if (event.button !== 0) {
      reason = "non_primary_button";
    } else if (kind === "touch" && pencilOnly) {
      reason = "pencil_only_touch";
    } else if (kind !== "pen" && this.active?.kind === "pen") {
      reason = "pen_priority";
    } else if (kind === "touch" && time - this.lastPenEnd < 300) {
      reason = "palm_after_pen";
    } else if (
      kind === "touch" &&
      this.active &&
      this.active.pointerId !== event.pointerId
    ) {
      reason = "secondary_touch";
    }
    if (reason) {
      this.blockedDown[kind]++;
      this.blockedReasons[reason] = (this.blockedReasons[reason] ?? 0) + 1;
      if (this.blockedContacts.size < 64) {
        this.blockedContacts.add(event.pointerId);
      }
      this.note(time, "pointerdown", event, false, reason);
      return { accepted: false, replaced: false };
    }
    const previous = this.active;
    if (
      previous &&
      previous.pointerId !== event.pointerId &&
      this.blockedContacts.size < 64
    ) {
      this.blockedContacts.add(previous.pointerId);
    }
    this.active = {
      pointerId: event.pointerId,
      kind,
      startedAtEventTimestamp:
        typeof event.timeStamp === "number" && Number.isFinite(event.timeStamp)
          ? event.timeStamp
          : null,
    };
    this.blockedContacts.delete(event.pointerId);
    this.admittedDown[kind]++;
    if (previous) {
      this.recoveries++;
    }
    this.note(
      time,
      "pointerdown",
      event,
      true,
      previous
        ? kind === "pen" && previous.kind !== "pen"
          ? "pen_preempts_contact"
          : "fresh_down_recovers_lifetime"
        : "new_contact",
    );
    return { accepted: true, replaced: previous !== null };
  }

  move(event: ContactEvent, time: number) {
    if (this.isOlderThanActive(event)) {
      return { record: false, block: true, interrupted: false };
    }
    const owns = this.active?.pointerId === event.pointerId;
    if (
      event.pointerType === "pen" &&
      !owns &&
      (event.buttons !== 0 || event.pressure > 0)
    ) {
      this.orphanPenContactMoves++;
    }
    if (event.pointerType === "touch" && !owns) {
      this.palmMovesBlocked++;
    }
    if (!owns) {
      return {
        record: false,
        block: event.pointerType === "touch" || this.active !== null,
        interrupted: false,
      };
    }
    if (
      event.pointerType === "pen" &&
      event.buttons === 0 &&
      event.pressure === 0
    ) {
      this.lastPenEnd = time;
      this.active = null;
      this.note(time, "pointermove", event, false, "hover_recovers_missing_up");
      return { record: false, block: false, interrupted: true };
    }
    return { record: true, block: false, interrupted: false };
  }

  end(event: ContactEvent, type: string, time: number) {
    if (this.isOlderThanActive(event)) {
      this.ignoreBoundary(event, type, time, "older_than_current_contact");
      return { accepted: false, blocked: true };
    }
    const blocked = this.blockedContacts.delete(event.pointerId);
    if (this.active?.pointerId !== event.pointerId) {
      return { accepted: false, blocked };
    }
    if (this.active.kind === "pen") {
      this.lastPenEnd = time;
    }
    this.active = null;
    this.note(time, type, event, true, "contact_ended");
    return { accepted: true, blocked: false };
  }

  reset(reason: ResetReason, time: number) {
    if (this.active?.kind === "pen") {
      this.lastPenEnd = time;
    }
    if (this.active) {
      this.resets++;
    }
    this.active = null;
    this.blockedContacts.clear();
    this.note(time, "reset", null, true, reason);
  }

  private isOlderThanActive(event: ContactEvent) {
    return (
      this.active?.pointerId === event.pointerId &&
      this.active.startedAtEventTimestamp !== null &&
      typeof event.timeStamp === "number" &&
      event.timeStamp < this.active.startedAtEventTimestamp
    );
  }

  ignoreBoundary(
    event: ContactEvent,
    type: string,
    time: number,
    reason: string,
  ) {
    this.staleBoundaryEvents++;
    this.note(time, type, event, false, reason);
  }

  noteLegacyTouch() {
    this.legacyTouchEvents++;
  }
  noteCoalescedReadFailure() {
    this.coalescedReadFailures++;
  }

  private note(
    time: number,
    event: string,
    pointer: ContactEvent | null,
    accepted: boolean,
    reason: string,
  ) {
    this.decisions[this.decisionCursor] = {
      time,
      event,
      pointerId: pointer?.pointerId ?? null,
      pointerType: pointer ? kindOf(pointer.pointerType) : null,
      accepted,
      reason,
    };
    this.decisionCursor = (this.decisionCursor + 1) % this.decisions.length;
    this.decisionCount = Math.min(
      this.decisionCount + 1,
      this.decisions.length,
    );
    this.decisionTotal++;
  }

  diagnostics() {
    const start =
      (this.decisionCursor - this.decisionCount + this.decisions.length) %
      this.decisions.length;
    return {
      receivedDown: { ...this.receivedDown },
      admittedDown: { ...this.admittedDown },
      blockedDown: { ...this.blockedDown },
      blockedReasons: { ...this.blockedReasons },
      recoveries: this.recoveries,
      orphanPenContactMoves: this.orphanPenContactMoves,
      palmMovesBlocked: this.palmMovesBlocked,
      legacyTouchEvents: this.legacyTouchEvents,
      lifecycleResets: this.resets,
      coalescedReadFailures: this.coalescedReadFailures,
      staleBoundaryEvents: this.staleBoundaryEvents,
      active: this.active ? { ...this.active } : null,
      omittedDecisionRecords: this.decisionTotal - this.decisionCount,
      recentDecisions: Array.from(
        { length: this.decisionCount },
        (_, index) => this.decisions[(start + index) % this.decisions.length]!,
      ),
    };
  }
}
