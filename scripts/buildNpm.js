// Internal workspaces stay private. Only this isolated staging directory is published.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const workspace = path.join(root, "packages/excalidraw");
const manifestPath = path.join(root, "npm/qudraw/package.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const workspaceManifest = require("../packages/excalidraw/package.json");
const destination = path.join(root, "dist/npm/qudraw");

if (manifest.name !== "qudraw" || manifest.private) {
  throw new Error("The public build is only permitted to target qudraw.");
}

function run(script, args = [], options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: workspace,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

if (!process.argv.includes("--stage-only")) {
  fs.rmSync(path.join(workspace, "dist"), { recursive: true, force: true });
  run(path.join(root, "scripts/buildPackage.js"), [], {
    env: {
      ...process.env,
      QUDRAW_PACKAGE_NAME: manifest.name,
      QUDRAW_PACKAGE_VERSION: manifest.version,
    },
  });
  run(require.resolve("typescript/bin/tsc"));
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(path.join(workspace, "dist"), path.join(destination, "dist"), {
  recursive: true,
});

// tsc preserves tsconfig path aliases. Rewrite them into the bundled declaration
// tree so consumers never need our private internal math/utils workspaces.
const typesRoot = path.join(destination, "dist/types");
const vendorRoot = path.join(typesRoot, "vendor");
fs.mkdirSync(vendorRoot, { recursive: true });
const browserFsRoot = path.dirname(
  require.resolve("browser-fs-access/package.json"),
);
fs.copyFileSync(
  path.join(browserFsRoot, "index.d.ts"),
  path.join(vendorRoot, "browser-fs-access.d.ts"),
);
fs.copyFileSync(
  path.join(browserFsRoot, "LICENSE"),
  path.join(vendorRoot, "browser-fs-access.LICENSE"),
);
const localesRoot = path.join(typesRoot, "excalidraw/locales");
fs.mkdirSync(localesRoot, { recursive: true });
const english = JSON.parse(
  fs.readFileSync(path.join(workspace, "locales/en.json"), "utf8"),
);
fs.writeFileSync(
  path.join(localesRoot, "en.json.d.ts"),
  `declare const messages: ${JSON.stringify(
    english,
    null,
    2,
  )};\nexport default messages;\n`,
);
for (const file of walk(typesRoot).filter((entry) => entry.endsWith(".d.ts"))) {
  const source = fs.readFileSync(file, "utf8");
  let rewritten = source.replace(
    /(["'])@excalidraw\/(excalidraw|math|utils)(\/[^"']*)?\1/g,
    (_, quote, workspaceName, subpath) => {
      const target = path.join(typesRoot, workspaceName, subpath || "index");
      let relative = path
        .relative(path.dirname(file), target)
        .split(path.sep)
        .join("/");
      if (!relative.startsWith(".")) {
        relative = `./${relative}`;
      }
      return `${quote}${relative}${quote}`;
    },
  );
  rewritten = rewritten.replace(/(["'])browser-fs-access\1/g, (_, quote) => {
    const relative = path
      .relative(path.dirname(file), path.join(vendorRoot, "browser-fs-access"))
      .split(path.sep)
      .join("/");
    return `${quote}${
      relative.startsWith(".") ? relative : `./${relative}`
    }${quote}`;
  });
  // React 19 removed the global JSX namespace. ReactElement works across all
  // supported React releases and does not leak a global React 17 declaration.
  rewritten = rewritten
    .replace(
      /(?:import\("react(?:\/jsx-runtime)?"\)\.|React\.)?\bJSX\.Element\b/g,
      'import("react").ReactElement',
    )
    .replace(/^import\s+["'][^"']+\.(?:s?css)["'];?\s*$/gm, "");
  fs.writeFileSync(file, rewritten);
}

for (const name of ["LICENSE", "UPSTREAM.json"]) {
  fs.copyFileSync(path.join(root, name), path.join(destination, name));
}
fs.copyFileSync(
  path.join(root, "npm/qudraw/README.md"),
  path.join(destination, "README.md"),
);
fs.copyFileSync(
  path.join(root, "npm/qudraw/THIRD_PARTY_NOTICES.txt"),
  path.join(destination, "THIRD_PARTY_NOTICES.txt"),
);
fs.cpSync(
  path.join(root, "npm/qudraw/FONT_LICENSES"),
  path.join(destination, "FONT_LICENSES"),
  { recursive: true },
);
for (const file of walk(path.join(workspace, "fonts"))) {
  if (/\/(LICENSE[^/]*|OFL[^/]*|NOTICE[^/]*)$/i.test(file)) {
    const relative = path.relative(path.join(workspace, "fonts"), file);
    const target = path.join(destination, "FONT_LICENSES", relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
  }
}
fs.writeFileSync(
  path.join(destination, "package.json"),
  `${JSON.stringify(
    {
      ...manifest,
      peerDependencies: workspaceManifest.peerDependencies,
      dependencies: workspaceManifest.dependencies,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`Publish-ready package: ${destination}\n`);
