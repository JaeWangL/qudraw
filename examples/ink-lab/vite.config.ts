import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const labRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(labRoot, "../..");

export default defineConfig({
  root: labRoot,
  envDir: labRoot,
  plugins: [react()],
  define: { "import.meta.env.VITE_APP_ENABLE_TRACKING": '"false"' },
  resolve: {
    alias: ["excalidraw", "math", "utils"].flatMap((name) => [
      {
        find: new RegExp(`^@excalidraw/${name}$`),
        replacement: path.resolve(
          repositoryRoot,
          `packages/${name}/index.${name === "excalidraw" ? "tsx" : "ts"}`,
        ),
      },
      {
        find: new RegExp(`^@excalidraw/${name}/(.*)`),
        replacement: path.resolve(repositoryRoot, `packages/${name}/$1`),
      },
    ]),
    dedupe: ["react", "react-dom"],
  },
  server: { port: 4174, strictPort: true, host: "0.0.0.0" },
  preview: { port: 4174, strictPort: true, host: "0.0.0.0" },
  build: { target: "es2022", outDir: "dist", assetsInlineLimit: 0 },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
