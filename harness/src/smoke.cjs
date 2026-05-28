// Milestone 1 smoke test: run a season through the Node-target wasm engine and
// print standings. Cross-checked against `cargo run --bin gandula -- season`.
//
// Pure CommonJS, no build step — proves the engine runs in Node before we wire
// up the esbuild bundle for the full career loop.

const fs = require("node:fs");
const path = require("node:path");
const wasm = require("../wasm-node/gandula_wasm.js");

const GANDULA = "/Users/felipe/Projects/gandula";

function loadTeam(relPath) {
  return JSON.parse(fs.readFileSync(path.join(GANDULA, relPath), "utf8"));
}

function points(s) {
  return s.won * 3 + s.drawn;
}

function fmtStandings(record, teamsById) {
  const rows = record.standings.map((s, i) => {
    const name = teamsById.get(s.team_id)?.name ?? `Time ${s.team_id}`;
    const gd = s.goals_for - s.goals_against;
    return [
      String(i + 1).padStart(2),
      name.padEnd(20),
      String(s.played).padStart(2),
      String(s.won).padStart(2),
      String(s.drawn).padStart(2),
      String(s.lost).padStart(2),
      String(s.goals_for).padStart(3),
      String(s.goals_against).padStart(3),
      (gd >= 0 ? "+" + gd : String(gd)).padStart(3),
      String(points(s)).padStart(3),
    ].join("  ");
  });
  const header = ["#", "Time".padEnd(20), " P", " V", " E", " D", " GP", " GC", " SG", "Pts"].join("  ");
  return [header, ...rows].join("\n");
}

function main() {
  const seed = BigInt(process.argv[2] ?? "1998");
  const teams = [
    loadTeam("assets/teams/santos_imperial.json"),
    loadTeam("assets/teams/flamenguinho_fc.json"),
    loadTeam("assets/teams/ipanema_atletico.json"),
  ];
  const teamsById = new Map(teams.map((t) => [t.id, t]));

  const record = wasm.run_season(teams, seed, "Brasileirão Imaginário 2026");

  console.log(`=== run_season (Node wasm), seed ${seed} ===`);
  console.log(fmtStandings(record, teamsById));
  console.log(`\nfixtures: ${record.fixtures.length}, matches: ${record.matches.length}`);
}

main();
