// Node-side replacement for gandula's `web/src/teams.ts`, which uses Vite's
// `import.meta.glob` (browser/build-only) to bundle the team JSONs. The esbuild
// build (build.mjs) redirects every `../teams` import inside the gandula web
// source to this module, so the real career/util functions get an identical
// ALL_TEAMS — just sourced via Node fs instead of Vite glob.
//
// Ordering matches gandula/web/src/teams.ts exactly (E.2): ALL_TEAMS is the 60
// fictional clubs sorted by id asc. The 3 hand-written SAMPLE_TEAMS are NOT in
// the registry — they were dropped (their ids 1–3 collide with fictional teams
// and they'd skew the talent gradient). divideIntoDivisions requires exactly 60.

import fs from "node:fs";
import path from "node:path";
import type { Team } from "../../../gandula/web/src/types";

const ASSETS = "/home/felipe/Projects/gandula/assets/teams";

function readTeam(file: string): Team {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Team;
}

const FICTIONAL_DIR = path.join(ASSETS, "fictional");

export const FICTIONAL_TEAMS: Team[] = fs
  .readdirSync(FICTIONAL_DIR)
  .filter((f) => f.endsWith(".json") && f !== "_mapping.json")
  .map((f) => readTeam(path.join(FICTIONAL_DIR, f)))
  .sort((a, b) => a.id - b.id);

export const ALL_TEAMS: Team[] = [...FICTIONAL_TEAMS];

export function teamById(id: number): Team | undefined {
  return ALL_TEAMS.find((t) => t.id === id);
}
