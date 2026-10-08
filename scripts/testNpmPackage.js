const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../dist/npm/qudraw");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const exists = (relative) =>
  assert.ok(
    fs.existsSync(path.join(root, relative)),
    `Missing package file: ${relative}`,
  );
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

assert.equal(manifest.name, "qudraw");
assert.equal(manifest.private, undefined);
assert.equal(
  manifest.repository.url,
  "git+https://github.com/jaewangl/qudraw.git",
);
assert.ok(manifest.peerDependencies.react.includes("^19.0.0"));
assert.equal(manifest.dependencies["@excalidraw/excalidraw"], undefined);
assert.equal(manifest.dependencies["@excalidraw/math"], undefined);
assert.equal(manifest.dependencies["@excalidraw/utils"], undefined);
for (const relative of [
  manifest.main,
  manifest.types,
  manifest.exports["./index.css"].default,
  "LICENSE",
  "THIRD_PARTY_NOTICES.txt",
  "FONT_LICENSES/Liberation/LICENSE",
  "FONT_LICENSES/Liberation/COPYING",
  "dist/types/vendor/browser-fs-access.LICENSE",
]) {
  exists(relative);
}

const files = walk(path.join(root, "dist"));
const declarations = files.filter((file) => file.endsWith(".d.ts"));
for (const file of declarations) {
  const source = fs.readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  assert.equal(
    parsed.parseDiagnostics.length,
    0,
    `Invalid TypeScript declaration syntax: ${file}`,
  );
  for (const { fileName: specifier } of ts.preProcessFile(source, true, true)
    .importedFiles) {
    assert.ok(
      !/^@excalidraw\/(excalidraw|utils|math)(\/|$)/.test(specifier),
      `Private workspace reference in ${file}: ${specifier}`,
    );
    if (!specifier.startsWith(".")) {
      continue;
    }
    const base = path.resolve(path.dirname(file), specifier);
    assert.ok(
      [base, `${base}.d.ts`, `${base}/index.d.ts`].some((target) =>
        fs.existsSync(target),
      ),
      `Unresolved declaration reference in ${file}: ${specifier}`,
    );
  }
}
const indexTypes = fs.readFileSync(path.join(root, manifest.types), "utf8");
assert.ok(indexTypes.includes("const QuDraw:"));
const props = fs.readFileSync(
  path.join(root, "dist/types/excalidraw/types.d.ts"),
  "utf8",
);
assert.ok(props.includes("handwritingMode?"));
assert.ok(props.includes("notebookTouchEnabled?"));
assert.ok(props.includes("onHandwritingMetrics?"));
for (const flavor of ["dev", "prod"]) {
  const stylesheet = fs.readFileSync(
    path.join(root, `dist/${flavor}/index.css`),
    "utf8",
  );
  for (const match of stylesheet.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    if (/^(?:data:|https?:)/.test(match[1])) {
      continue;
    }
    exists(`dist/${flavor}/${match[1]}`);
  }
  assert.ok(
    files.some(
      (file) =>
        file.includes(`/dist/${flavor}/locales/ko-KR-`) && file.endsWith(".js"),
    ),
    `Missing Korean locale chunk: ${flavor}`,
  );
  assert.ok(
    files.some(
      (file) =>
        file.includes(`/dist/${flavor}/fonts/Excalifont/`) &&
        file.endsWith(".woff2"),
    ),
    `Missing drawing fonts: ${flavor}`,
  );
}
const devJavaScript = files
  .filter((file) => file.includes("/dist/dev/") && file.endsWith(".js"))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
assert.ok(devJavaScript.includes(`PKG_NAME: "qudraw"`));
assert.ok(devJavaScript.includes(`PKG_VERSION: "${manifest.version}"`));
process.stdout.write(
  `qudraw package integrity passed: ${declarations.length} declaration files, CSS assets, fonts, locales, and public exports.\n`,
);
