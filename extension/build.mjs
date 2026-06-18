// Minimal esbuild script. Explicit entry points, no plugins, no magic — a new
// developer can read this file top to bottom and know exactly what is bundled
// and where it lands.
//
//   node build.mjs            one-off build
//   node build.mjs --watch    rebuild on change
//
// Each entry compiles to dist/<dir>/<name>.js, matching the paths referenced in
// manifest.json. Static assets (manifest, panel.html) are copied verbatim.

import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const outdir = "dist";

const entryPoints = {
  "content/inject-button": "src/content/inject-button.ts",
  "background/service-worker": "src/background/service-worker.ts",
  "sidepanel/panel": "src/sidepanel/panel.ts",
};

// Page injected into YouTube's main world to read ytInitialPlayerResponse.
// Built separately because it must run as a classic script, not a module.
const pageScript = {
  "youtube/page-reader": "src/youtube/page-reader.ts",
};

async function copyStatic() {
  await cp("manifest.json", `${outdir}/manifest.json`);
  await cp("src/sidepanel/panel.html", `${outdir}/sidepanel/panel.html`);
  await cp("icons", `${outdir}/icons`, { recursive: true });
}

const common = {
  bundle: true,
  format: "esm",
  target: "chrome116",
  sourcemap: true,
  logLevel: "info",
};

async function run() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const ctxMain = await esbuild.context({ ...common, entryPoints, outdir });
  // page-reader runs in the page's main world; keep it as an IIFE classic script.
  const ctxPage = await esbuild.context({
    ...common,
    format: "iife",
    entryPoints: pageScript,
    outdir,
  });

  await copyStatic();

  if (watch) {
    await Promise.all([ctxMain.watch(), ctxPage.watch()]);
    console.log("watching…");
  } else {
    await Promise.all([ctxMain.rebuild(), ctxPage.rebuild()]);
    await ctxMain.dispose();
    await ctxPage.dispose();
    console.log("build complete -> dist/");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
