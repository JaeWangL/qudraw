# qudraw

- This independent repository starts from the Excalidraw version recorded in UPSTREAM.json. The public source is JaeWangL/qudraw. Retain upstream MIT license and copyright notices.
- Do not call external model APIs for development, tests or experiments.
- Human Apple Pencil feedback is authoritative for subjective handwriting quality. Synthetic input timings are proxies, not physical pen-to-photon latency.
- Preserve pointer boundaries, pressures, undo/redo and original ink points. Never join separate pointerdown/up strokes.
- Handwriting changes must be opt-in with unchanged classic rendering for old scenes. New rendering options must survive save/restore and exports.
- Do not alter or deploy the assessment application as part of this experiment.
- Keep upstream release/publish/deployment workflows disabled. Never publish a package under upstream ownership. Only the explicitly prepared `qudraw` package is eligible for an authorized npm release; internal `@excalidraw/*` workspaces stay private.
- Build and inspect the npm tarball, including its types, styles, assets and license notices, and verify a separate consumer before publishing. Never include local handwriting captures, credentials or ignored runtime artifacts in a public source snapshot or npm package.
- Lab captures stay local unless a person explicitly exports them; no telemetry, cloud sync or AI calls.
- Run targeted handwriting tests, type checks and the lab production build. Document existing upstream failures separately.
