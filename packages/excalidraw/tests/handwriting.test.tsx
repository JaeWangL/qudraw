import React from "react";
import { getStrokePoints } from "perfect-freehand";
import { vi } from "vitest";
import { Excalidraw } from "../index";
import { restoreElements } from "../data/restore";
import { getFreeDrawSvgPath } from "../renderer/renderElement";
import {
  NotebookStrokeSession,
  notebookInkProfile,
  notebookStrokeOptions,
} from "../handwriting/notebook";
import type { ExcalidrawFreeDrawElement } from "../element/types";
import {
  GlobalTestState,
  render,
  fireEvent,
  unmountComponent,
  act,
} from "./test-utils";
import { UI, Keyboard } from "./helpers/ui";
import { KEYS } from "../keys";
import type { ExcalidrawImperativeAPI } from "../types";
import { API } from "./helpers/api";

const { h } = window;

const pointer = (
  type: string,
  x: number,
  y: number,
  overrides: Partial<PointerEvent> = {},
) => {
  const event = new PointerEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    pointerId: 41,
    pointerType: "pen",
    pressure: type === "pointerup" ? 0 : 0.5,
    buttons: type === "pointerup" ? 0 : 1,
  });
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(event, key, { value });
  }
  return event;
};

const send = (
  type: string,
  x: number,
  y: number,
  overrides: Partial<PointerEvent> = {},
) => {
  fireEvent(GlobalTestState.interactiveCanvas, pointer(type, x, y, overrides));
};

const strokes = () =>
  h.elements.filter(
    (element): element is ExcalidrawFreeDrawElement =>
      element.type === "freedraw" && !element.isDeleted,
  );

const sendTouch = (
  type: string,
  contacts: Array<{ id: number; type: "direct" | "stylus" }>,
) => {
  const touches = contacts.map(({ id, type: touchType }) => ({
    identifier: id,
    clientX: id * 10,
    clientY: id * 10,
    target: GlobalTestState.interactiveCanvas,
    touchType,
  }));
  fireEvent(
    GlobalTestState.interactiveCanvas,
    new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: touches as unknown as Touch[],
      targetTouches: touches as unknown as Touch[],
    }),
  );
};

const sendGesture = (type: string, scale: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "scale", { value: scale });
  fireEvent(document, event);
};

describe("notebook handwriting lifecycle", () => {
  const metrics = vi.fn();
  let editor: ExcalidrawImperativeAPI;
  beforeEach(async () => {
    unmountComponent();
    metrics.mockClear();
    await render(
      <Excalidraw
        handwritingMode="notebook"
        onHandwritingMetrics={metrics}
        excalidrawAPI={(api) => {
          editor = api;
        }}
        handleKeyboardGlobally
      />,
    );
    UI.clickTool("freedraw");
  });

  it("retains ordered coalesced samples, true pressure at .5, and the last pen-up position", () => {
    send("pointerdown", 20, 20);
    const first = pointer("pointermove", 25, 25, { pressure: 0.2 });
    const second = pointer("pointermove", 30, 30, { pressure: 0.8 });
    send("pointermove", 30, 30, {
      pressure: 0.8,
      getCoalescedEvents: () => [first, second],
    });
    send("pointerup", 40, 35);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [5, 5],
      [10, 10],
      [20, 15],
    ]);
    expect(strokes()[0].pressures).toEqual([0.5, 0.2, 0.8, 0]);
    expect(strokes()[0].simulatePressure).toBe(false);
    expect(metrics).toHaveBeenCalledTimes(1);
    expect(metrics.mock.calls[0][0]).toMatchObject({
      acceptedSamples: 4,
      coalescedSamples: 2,
    });
  });

  it("ignores palm input and foreign pointer-up while the Pencil is active", () => {
    send("pointerdown", 20, 20);
    send("pointermove", 30, 30);
    send("pointerdown", 200, 200, { pointerType: "touch", pointerId: 42 });
    send("pointermove", 250, 250, { pointerType: "touch", pointerId: 42 });
    send("pointerup", 250, 250, { pointerType: "touch", pointerId: 42 });
    expect(metrics).not.toHaveBeenCalled();
    send("pointerup", 40, 40);
    expect(strokes()).toHaveLength(1);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
  });

  it("accepts Pencil when a palm arrived first in pen mode, including native Safari touch events", () => {
    API.setAppState({ penMode: true, penDetected: true });
    sendTouch("touchstart", [{ id: 71, type: "direct" }]);
    send("pointerdown", 220, 220, { pointerType: "touch", pointerId: 71 });
    sendTouch("touchstart", [
      { id: 71, type: "direct" },
      { id: 41, type: "stylus" },
    ]);
    send("pointerdown", 20, 20);
    send("pointermove", 30, 30);
    // The OS may report touchend before the corresponding pointerup.
    sendTouch("touchend", [{ id: 41, type: "stylus" }]);
    send("pointerup", 220, 220, { pointerType: "touch", pointerId: 71 });
    send("pointerup", 40, 40);
    sendTouch("touchend", []);
    expect(strokes()).toHaveLength(1);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
    expect(h.state.scrollX).toBe(0);
    expect(h.state.scrollY).toBe(0);
  });

  it("ignores palm ink before the first-ever Pencil contact", () => {
    sendTouch("touchstart", [{ id: 71, type: "direct" }]);
    send("pointerdown", 220, 220, { pointerType: "touch", pointerId: 71 });
    send("pointermove", 250, 230, { pointerType: "touch", pointerId: 71 });
    send("pointerup", 250, 230, { pointerType: "touch", pointerId: 71 });
    sendTouch("touchend", []);
    expect(strokes()).toHaveLength(0);
    send("pointerdown", 20, 20);
    send("pointerup", 40, 40);
    expect(strokes()).toHaveLength(1);
  });

  it("does not zoom or restore a selection through legacy Safari gesture events while inking", () => {
    send("pointerdown", 20, 20);
    sendTouch("touchstart", [
      { id: 41, type: "stylus" },
      { id: 71, type: "direct" },
    ]);
    sendGesture("gesturestart", 1);
    sendGesture("gesturechange", 1.5);
    sendGesture("gestureend", 1.5);
    sendTouch("touchend", []);
    send("pointermove", 30, 30);
    send("pointerup", 40, 40);
    expect(h.state.zoom.value).toBe(1);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
    expect(h.state.activeTool.type).toBe("freedraw");
    expect(h.state.editingTextElement).toBeNull();
  });

  it("survives repeated palm/Pencil alternation with new pointer IDs and interleaved native touchend", () => {
    API.setAppState({ penMode: true, penDetected: true });
    for (let index = 0; index < 40; index++) {
      const palm = { pointerType: "touch", pointerId: 100 + index };
      const pen = { pointerId: 200 + index };
      sendTouch("touchstart", [{ id: palm.pointerId, type: "direct" }]);
      send("pointerdown", 220, 220, palm);
      send("pointerdown", 20, 20, pen);
      send("pointermove", 30, 30, pen);
      sendTouch("touchend", []);
      send("pointerup", 220, 220, palm);
      send("pointermove", 35, 35, pen);
      send("pointerup", 40, 40, pen);
    }
    expect(strokes()).toHaveLength(40);
    expect(strokes().every((stroke) => stroke.points.length === 4)).toBe(true);
    expect(metrics).toHaveBeenCalledTimes(40);
    expect(h.state.zoom.value).toBe(1);
    expect(h.state.scrollX).toBe(0);
    expect(h.state.scrollY).toBe(0);
  });

  it("supports opt-in single-finger drawing while preserving Pencil priority", async () => {
    unmountComponent();
    await render(
      <Excalidraw handwritingMode="notebook" notebookTouchEnabled />,
    );
    UI.clickTool("freedraw");
    API.setAppState({ penMode: true, penDetected: true });
    const finger = { pointerType: "touch", pointerId: 71 };
    send("pointerdown", 100, 100, finger);
    send("pointermove", 110, 110, finger);
    send("pointerdown", 20, 20);
    sendTouch("touchstart", [
      { id: 41, type: "stylus" },
      { id: 71, type: "direct" },
    ]);
    send("pointermove", 30, 30);
    send("pointermove", 500, 500, finger);
    send("pointerup", 500, 500, finger);
    send("pointerup", 40, 40);
    expect(strokes()).toHaveLength(2);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
    ]);
    expect(strokes()[1].points).toEqual([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
    // Finger drawing remains explicitly available even after detecting Pencil.
    send("pointerdown", 200, 200, finger);
    send("pointerup", 210, 210, finger);
    expect(strokes()).toHaveLength(3);
  });

  it("a second finger cannot take over an accepted finger stroke", async () => {
    unmountComponent();
    await render(
      <Excalidraw handwritingMode="notebook" notebookTouchEnabled />,
    );
    UI.clickTool("freedraw");
    const first = { pointerType: "touch", pointerId: 71 };
    const second = { pointerType: "touch", pointerId: 72 };
    send("pointerdown", 20, 20, first);
    send("pointermove", 30, 30, first);
    send("pointerdown", 200, 200, second);
    sendTouch("touchstart", [
      { id: 71, type: "direct" },
      { id: 72, type: "direct" },
    ]);
    send("pointermove", 250, 250, second);
    send("pointerup", 250, 250, second);
    send("pointerup", 40, 40, first);
    expect(strokes()).toHaveLength(1);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture"])(
    "rejects a stale %s from a previous stroke with the same Pencil ID",
    (type) => {
      send("pointerdown", 20, 20, { timeStamp: 10 });
      send("pointermove", 30, 30, { timeStamp: 20 });
      send("pointerup", 40, 40, { timeStamp: 30 });
      send("pointerdown", 100, 100, { timeStamp: 40 });
      send(type, 400, 400, { timeStamp: 35 });
      send("pointermove", 110, 110, { timeStamp: 50 });
      send("pointerup", 120, 120, { timeStamp: 60 });
      expect(strokes()).toHaveLength(2);
      expect(strokes()[1].points).toEqual([
        [0, 0],
        [10, 10],
        [20, 20],
      ]);
      expect(metrics).toHaveBeenCalledTimes(2);
    },
  );

  it("ignores a prior capture-loss notification while the new Pencil stroke still owns capture", () => {
    const canvas = GlobalTestState.interactiveCanvas;
    const hasPointerCapture = vi.fn(() => true);
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: hasPointerCapture,
    });
    send("pointerdown", 20, 20);
    send("lostpointercapture", 400, 400);
    send("pointermove", 30, 30);
    hasPointerCapture.mockReturnValue(false);
    send("lostpointercapture", 500, 500);
    send("pointermove", 600, 600);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
    ]);
    expect(metrics).toHaveBeenCalledTimes(1);
  });

  it("a palm cannot erase or end a Pencil eraser interaction", () => {
    send("pointerdown", 20, 20);
    send("pointerup", 40, 40);
    send("pointerdown", 100, 100);
    send("pointerup", 120, 120);
    UI.clickTool("eraser");
    send("pointerdown", 30, 30);
    send("pointermove", 32, 32);
    send("pointerdown", 110, 110, { pointerType: "touch", pointerId: 71 });
    send("pointermove", 115, 115, { pointerType: "touch", pointerId: 71 });
    send("pointerup", 115, 115, { pointerType: "touch", pointerId: 71 });
    send("pointerup", 35, 35);
    expect(strokes()).toHaveLength(1);
    expect(strokes()[0].x).toBe(100);
  });

  it.each(["pointercancel", "lostpointercapture", "missing"])(
    "recovers a notebook eraser after %s without leaving old input listeners",
    (end) => {
      send("pointerdown", 20, 20);
      send("pointerup", 40, 40);
      send("pointerdown", 100, 100);
      send("pointerup", 120, 120);
      UI.clickTool("eraser");
      send("pointerdown", 30, 30);
      send("pointermove", 32, 32);
      if (end !== "missing") {
        send(end, 900, 900);
      }
      UI.clickTool("freedraw");
      const next = { pointerId: 99 };
      send("pointerdown", 200, 200, next);
      // Late input from the terminated eraser must not erase the other mark.
      send("pointermove", 110, 110);
      send("pointermove", 210, 210, next);
      send("pointerup", 220, 220, next);
      expect(strokes()).toHaveLength(2);
      expect(strokes().map((stroke) => stroke.x)).toEqual([100, 200]);
      expect(strokes()[1].points).toEqual([
        [0, 0],
        [10, 10],
        [20, 20],
      ]);
    },
  );

  it("does not mistake positive pen pressure with zero buttons for hover", () => {
    send("pointerdown", 20, 20);
    send("pointermove", 30, 30, { buttons: 0, pressure: 0.4 });
    expect(metrics).not.toHaveBeenCalled();
    send("pointerup", 40, 40);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
  });

  it("keeps the outer sample when a browser coalesced-event shim fails", () => {
    send("pointerdown", 20, 20);
    send("pointermove", 30, 30, {
      getCoalescedEvents: () => {
        throw new Error("unavailable");
      },
    });
    send("pointerup", 40, 40);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
    expect(metrics).toHaveBeenCalledTimes(1);
  });

  it.each(["pointercancel", "lostpointercapture"])(
    "closes %s at the last ink sample and starts a separate mark",
    (type) => {
      send("pointerdown", 20, 20);
      send("pointermove", 30, 30);
      send(type, 900, 900);
      send("pointermove", 950, 950);
      send("pointerdown", 100, 100);
      send("pointerup", 110, 110);
      expect(strokes()).toHaveLength(2);
      expect(strokes()[0].points).toEqual([
        [0, 0],
        [10, 10],
      ]);
      expect(strokes()[1].points).toEqual([
        [0, 0],
        [10, 10],
      ]);
      expect(metrics).toHaveBeenCalledTimes(2);
    },
  );

  it("a missing pointer-up never connects to the next pointer-down origin", () => {
    send("pointerdown", 20, 20);
    send("pointermove", 30, 30);
    send("pointerdown", 200, 200);
    send("pointerup", 210, 210);
    expect(strokes()).toHaveLength(2);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
    ]);
    expect(strokes()[1].x).toBe(200);
  });

  it.each(["blur", "focus"])(
    "%s recovery closes at the last sample without a line back to the origin",
    (type) => {
      send("pointerdown", 20, 20);
      send("pointermove", 30, 30);
      fireEvent(window, new Event(type));
      expect(strokes()[0].points).toEqual([
        [0, 0],
        [10, 10],
      ]);
      expect(metrics).toHaveBeenCalledTimes(1);
    },
  );

  it("hover after a missing pointer-up cannot add a connecting stroke", () => {
    send("pointerdown", 20, 20);
    send("pointermove", 30, 30);
    send("pointermove", 400, 400, { buttons: 0, pressure: 0 });
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
    ]);
    expect(metrics).toHaveBeenCalledTimes(1);
  });

  it("keeps completed geometry identical through JSON restore and undo/redo", () => {
    send("pointerdown", 20, 20);
    send("pointermove", 35, 30);
    send("pointerup", 45, 35);
    const original = strokes()[0];
    const path = getFreeDrawSvgPath(original);
    const [restored] = restoreElements(
      JSON.parse(JSON.stringify([original])),
      null,
    );
    expect(restored.customData?.qudrawInk).toEqual(notebookInkProfile(true));
    expect(getFreeDrawSvgPath(restored as ExcalidrawFreeDrawElement)).toBe(
      path,
    );
    Keyboard.withModifierKeys({ ctrl: true }, () => Keyboard.keyPress(KEYS.Z));
    expect(strokes()).toHaveLength(0);
    Keyboard.withModifierKeys({ ctrl: true, shift: true }, () =>
      Keyboard.keyPress(KEYS.Z),
    );
    expect(getFreeDrawSvgPath(strokes()[0])).toBe(path);
  });

  it("does not snap a near-closed handwritten shape to its starting point", () => {
    send("pointerdown", 20, 20);
    send("pointermove", 50, 20);
    send("pointermove", 50, 50);
    send("pointermove", 20, 50);
    send("pointerup", 22, 22);
    expect(strokes()[0].points.at(-1)).toEqual([2, 2]);
  });

  it("keeps taps visible as separate dots and cleans up on unmount", () => {
    send("pointerdown", 20, 20);
    send("pointerup", 20, 20, { pressure: 0.5 });
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [0.0001, 0.0001],
    ]);
    send("pointerdown", 60, 60);
    unmountComponent();
    fireEvent(window, pointer("pointermove", 90, 90));
    fireEvent(window, pointer("pointerup", 100, 100));
    expect(metrics).toHaveBeenCalledTimes(1);
  });

  it("keeps a pressure-releasing tap visible", () => {
    send("pointerdown", 20, 20);
    send("pointerup", 20, 20);
    expect(strokes()).toHaveLength(1);
    expect(strokes()[0].points.at(-1)).toEqual([0.0001, 0.0001]);
    expect(strokes()[0].pressures).toHaveLength(strokes()[0].points.length);
  });

  it("releases its lifetime when the host resets the active scene", () => {
    send("pointerdown", 20, 20);
    send("pointermove", 30, 30);
    act(() => editor.resetScene());
    send("pointerup", 40, 40);
    expect(strokes()).toHaveLength(0);
    UI.clickTool("freedraw");
    send("pointerdown", 100, 100, { pointerId: 42 });
    send("pointerup", 110, 110, { pointerId: 42 });
    expect(strokes()).toHaveLength(1);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
    ]);
  });

  it("remounting during ink does not leave a ghost gesture pointer", async () => {
    send("pointerdown", 20, 20);
    send("pointermove", 30, 30);
    unmountComponent();
    await render(<Excalidraw handwritingMode="notebook" />);
    UI.clickTool("freedraw");
    send("pointerdown", 100, 100, { pointerId: 42 });
    send("pointermove", 110, 110, { pointerId: 42 });
    send("pointerup", 120, 120, { pointerId: 42 });
    expect(strokes()).toHaveLength(1);
    expect(strokes()[0].points).toEqual([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
    expect(h.state.scrollX).toBe(0);
    expect(h.state.scrollY).toBe(0);
  });
});

describe("handwriting profile compatibility", () => {
  it("leaves default classic strokes unmarked and with classic pressure behavior", async () => {
    unmountComponent();
    await render(<Excalidraw />);
    UI.clickTool("freedraw");
    send("pointerdown", 20, 20);
    send("pointermove", 30, 30);
    send("pointerup", 40, 40);
    expect(strokes()[0].customData?.qudrawInk).toBeUndefined();
    expect(strokes()[0].simulatePressure).toBe(true);
    const original = strokes()[0];
    expect(
      getFreeDrawSvgPath({
        ...original,
        customData: {
          qudrawInk: { version: 999, profile: "notebook", completed: true },
        },
      }),
    ).toBe(getFreeDrawSvgPath(original));
  });

  it("eliminates the algorithm's centerline endpoint lag independently of scheduling", () => {
    const points = Array.from({ length: 21 }, (_, index) => [
      index * 5,
      0,
      0.5,
    ]);
    const classic = getStrokePoints(points, {
      size: 2.125,
      streamline: 0.5,
      last: false,
    });
    const options = notebookStrokeOptions({
      strokeWidth: 0.5,
      customData: { qudrawInk: notebookInkProfile(false) },
    });
    const notebook = getStrokePoints(points, options);
    expect(classic[classic.length - 1].point[0]).toBeLessThan(100);
    expect(notebook[notebook.length - 1].point[0]).toBe(100);
  });

  it("rejects stale and foreign samples and closes a lifetime only once", () => {
    const start = pointer("pointerdown", 0, 0, { timeStamp: 10 });
    const session = new NotebookStrokeSession("ink", 41, "pen", start);
    expect(
      session.samples(pointer("pointermove", 10, 10, { timeStamp: 9 })),
    ).toEqual([]);
    expect(
      session.samples(pointer("pointermove", 10, 10, { pointerId: 50 })),
    ).toEqual([]);
    expect(
      session.samples(pointer("pointermove", 10, 10, { timeStamp: 11 })),
    ).toHaveLength(1);
    expect(session.close()).not.toBeNull();
    expect(session.close()).toBeNull();
    expect(session.samples(pointer("pointermove", 20, 20))).toEqual([]);
  });
});
