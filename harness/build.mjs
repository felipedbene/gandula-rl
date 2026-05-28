// Bundle the headless career harness into a single self-contained Node CJS file.
//
// The harness imports gandula's REAL career/util TypeScript directly from
// /Users/felipe/Projects/gandula/web/src. Two of those modules can't run under
// Node as-is, so we redirect them at bundle time:
//
//   1. `../wasm/gandula_wasm.js`  → the web-target wasm build (async fetch init).
//      Redirected to our `--target nodejs` build (synchronous, CJS) in
//      harness/wasm-node/, which exposes the same play_match/run_season/
//      derive_match_seed API.
//
//   2. `../teams`                 → uses Vite's import.meta.glob to inline team
//      JSONs. Redirected to src/teams-node.ts, which reads the same JSONs via fs
//      and exposes an identical ALL_TEAMS / teamById.
//
// `idb` (pulled in by persistence.ts) bundles fine and is never invoked here.

import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WASM_NODE = path.join(HERE, "wasm-node", "gandula_wasm.js");
const TEAMS_NODE = path.join(HERE, "src", "teams-node.ts");

/** Redirect the gandula web imports that don't run under Node. */
const redirectPlugin = {
  name: "gandula-node-redirects",
  setup(build) {
    // Any import whose specifier ends in gandula_wasm.js → Node wasm build.
    // Kept EXTERNAL so its __dirname stays wasm-node/ at runtime, where the
    // companion gandula_wasm_bg.wasm lives (otherwise it'd be sought in dist/).
    build.onResolve({ filter: /gandula_wasm\.js$/ }, () => ({ path: WASM_NODE, external: true }));
    // `../teams` / `./teams` imported from within gandula web/src → teams-node.
    build.onResolve({ filter: /^\.{1,2}\/teams$/ }, (args) => {
      if (args.importer.includes(`${path.sep}gandula${path.sep}web${path.sep}src`)) {
        return { path: TEAMS_NODE };
      }
      return undefined;
    });
  },
};

const targets = [
  { in: path.join(HERE, "src", "career-smoke.ts"), out: path.join(HERE, "dist", "career-smoke.cjs") },
  { in: path.join(HERE, "src", "server.ts"), out: path.join(HERE, "dist", "server.cjs") },
];

for (const t of targets) {
  await esbuild.build({
    entryPoints: [t.in],
    outfile: t.out,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    plugins: [redirectPlugin],
    loader: { ".json": "json" },
    logLevel: "info",
  });
}
