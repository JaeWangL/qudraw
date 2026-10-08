import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Test the actual packed artifact outside the workspace, where private aliases
// and hoisted type dependencies cannot conceal packaging mistakes.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "npm/qudraw/package.json"), "utf8"),
);
const tarball = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "dist/npm", `qudraw-${manifest.version}.tgz`);
const digest = createHash("sha256")
  .update(await readFile(tarball))
  .digest("hex");
const cwd = await mkdtemp(path.join(tmpdir(), "qudraw-consumer-"));
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  }
};

try {
  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify({
      name: "qudraw-isolated-consumer-test",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: {
        qudraw: `file:${tarball}`,
        react: "19.0.0",
        "react-dom": "19.0.0",
      },
      devDependencies: {
        "@types/react": "19.0.10",
        "@types/react-dom": "19.0.4",
        typescript: "5.9.3",
        vite: "5.0.12",
      },
    }),
  );
  await writeFile(
    path.join(cwd, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["DOM", "ES2022"],
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        esModuleInterop: true,
      },
      include: ["main.tsx"],
    }),
  );
  await writeFile(
    path.join(cwd, "index.html"),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    path.join(cwd, "main.tsx"),
    `import { createRoot } from "react-dom/client";
import { QuDraw, Excalidraw, type QuDrawProps, type HandwritingMetrics, type ExcalidrawImperativeAPI } from "qudraw";
import type { ExcalidrawProps } from "qudraw/types";
import type { ExcalidrawElement } from "qudraw/element/types";
import "qudraw/index.css";
window.EXCALIDRAW_ASSET_PATH = "/qudraw/";
const compatible: typeof QuDraw = Excalidraw;
void compatible;
const props: QuDrawProps & ExcalidrawProps = {
  handwritingMode: "notebook",
  notebookTouchEnabled: false,
  aiEnabled: false,
  onHandwritingMetrics: (metrics: HandwritingMetrics) => { void metrics.acceptedSamples; },
  excalidrawAPI: (api: ExcalidrawImperativeAPI) => {
    const elements: readonly ExcalidrawElement[] = api.getSceneElements();
    void elements;
  },
};
createRoot(document.getElementById("root")!).render(<div style={{height:600}}><QuDraw {...props}/></div>);
`,
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
  run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
  run(process.execPath, [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
    "--moduleResolution",
    "Node",
  ]);
  run(process.execPath, [
    "--input-type=module",
    "-e",
    'console.log("Default CSS export:", import.meta.resolve("qudraw/index.css"))',
  ]);
  run(process.execPath, ["node_modules/vite/bin/vite.js", "build"]);
  process.stdout.write(`Consumer checks passed for SHA-256 ${digest}\n`);
} finally {
  await rm(cwd, { recursive: true, force: true });
}
