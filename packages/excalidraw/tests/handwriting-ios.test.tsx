import React from "react";
import { vi } from "vitest";
import { Excalidraw } from "../index";
import {
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
} from "./test-utils";
import { UI } from "./helpers/ui";

vi.mock("../constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../constants")>()),
  // Exercise the runtime notebook fallback, including desktop-UA iPadOS,
  // without relying on the legacy module's ontouchend capability heuristic.
  isIOS: false,
}));

describe("iOS notebook Scribble protection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    {
      userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
      platform: "iPad",
    },
    {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
    },
  ])(
    "prevents stylus touchstart on $platform before skipping legacy gestures",
    async ({ userAgent, platform }) => {
      // pepjs defines maxTouchPoints as non-configurable in this test runtime.
      // Delegate all other navigator APIs with their real receiver intact.
      const originalNavigator = navigator;
      vi.stubGlobal(
        "navigator",
        new Proxy(
          {},
          {
            get: (_, property) => {
              if (property === "userAgent") {
                return userAgent;
              }
              if (property === "platform") {
                return platform;
              }
              if (property === "maxTouchPoints") {
                return 5;
              }
              const value = Reflect.get(
                originalNavigator,
                property,
                originalNavigator,
              );
              return typeof value === "function"
                ? value.bind(originalNavigator)
                : value;
            },
          },
        ),
      );
      unmountComponent();
      await render(<Excalidraw handwritingMode="notebook" />);
      UI.clickTool("freedraw");
      const canvas = GlobalTestState.interactiveCanvas;
      for (let count = 0; count < 2; count++) {
        const touches = [
          {
            identifier: 41,
            clientX: 20,
            clientY: 20,
            target: canvas,
            touchType: "stylus",
          },
        ] as unknown as Touch[];
        const event = new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          touches,
          targetTouches: touches,
        });
        fireEvent(canvas, event);
        expect(event.defaultPrevented).toBe(true);
      }
      expect(window.h.state.activeTool.type).toBe("freedraw");
      expect(window.h.state.editingTextElement).toBeNull();
      unmountComponent();
    },
  );
});
