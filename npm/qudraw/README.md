# qudraw

A React drawing canvas based on Excalidraw, with opt-in notebook handwriting and Apple Pencil palm isolation. MIT licensed. Maintained independently at [jaewangl/qudraw](https://github.com/jaewangl/qudraw).

## Install

```sh
npm install qudraw react react-dom
```

```tsx
import { QuDraw } from "qudraw";
import "qudraw/index.css";

export function Notebook() {
  return (
    <div style={{ width: "100%", height: 600, touchAction: "none" }}>
      <QuDraw
        handwritingMode="notebook"
        notebookTouchEnabled={false}
        langCode="ko-KR"
        initialData={{
          appState: {
            activeTool: {
              type: "freedraw",
              customType: null,
              locked: false,
              lastActiveTool: null,
            },
            currentItemStrokeWidth: 0.5,
          },
        }}
      />
    </div>
  );
}
```

`handwritingMode="notebook"` opts into direct stroke sampling, minimal smoothing, real pressure and independent pen contacts. The default is `"classic"` for compatibility. Notebook ink metadata survives scene export and restore. Palm isolation applies to the notebook pen and eraser; `notebookTouchEnabled={false}` accepts pen and mouse input, while `true` also permits finger drawing. No mode can eliminate the physical latency of the device or browser.

`Excalidraw` remains available as an alias of `QuDraw`. Existing editor APIs, scene helpers and compound components remain exported. Type-only subpaths such as `qudraw/types` and `qudraw/element/types` are supported.

```tsx
import type {
  QuDrawProps,
  ExcalidrawImperativeAPI,
  HandwritingMetrics,
} from "qudraw";
import type { ExcalidrawElement } from "qudraw/element/types";
```

The canvas is browser-only and needs a container with a definite height. React 17, 18 and 19 are supported. Import the stylesheet once in your application's client entry or root layout.

## Next.js App Router

Load the component from a client wrapper with SSR disabled. Keep server components free of runtime imports from `qudraw`.

```tsx
"use client";

import dynamic from "next/dynamic";
import "qudraw/index.css";

const QuDraw = dynamic(() => import("qudraw").then((module) => module.QuDraw), {
  ssr: false,
});

export default function Notebook() {
  return (
    <div style={{ height: "100dvh", width: "100%", touchAction: "none" }}>
      <QuDraw handwritingMode="notebook" notebookTouchEnabled={false} />
    </div>
  );
}
```

## Fonts and assets

Editor UI fonts are imported by the CSS. Drawing fonts default to the versioned `qudraw` assets on esm.sh. For offline/private hosting, copy the installed package's `dist/prod` directory to a public directory, then set the following before mounting the editor:

```ts
window.EXCALIDRAW_ASSET_PATH = "/qudraw-assets/";
```

For example, copy `node_modules/qudraw/dist/prod` to `public/qudraw-assets`. The variable retains its upstream name for compatibility. Keep the directory structure, including fonts and chunks. Font copyright and license notices ship in `THIRD_PARTY_NOTICES.txt`.

## Development

The Git repository keeps its internal workspaces private; do not publish those workspaces. Run `yarn build:npm` to create the isolated public package at `dist/npm/qudraw`, or `yarn pack:npm` to create its tarball. Only the staged package is intended for publishing.

Upstream provenance and original MIT attribution are retained in `UPSTREAM.json` and `LICENSE`.
