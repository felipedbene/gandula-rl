// Maps the engine's `play_match` / `run_season` to their *light* variants
// (event logs stripped) for the headless RL harness. The harness — and the
// gandula web util it reuses — only read scorelines + standings, never the
// minute-by-minute event log, so dropping it avoids building a JS object per
// event across the wasm boundary (the dominant cost of the round-trip).
//
// build.mjs redirects every `gandula_wasm.js` import to this shim, so both
// career.ts and the reused gandula web util pick up the light engine
// transparently, with no change to the gandula repo.
const w = require("./wasm-node/gandula_wasm.js");

module.exports = {
  play_match: w.play_match_light || w.play_match,
  run_season: w.run_season_light || w.run_season,
  derive_match_seed: w.derive_match_seed,
  // Full-fidelity variants kept available if ever needed.
  play_match_full: w.play_match,
  run_season_full: w.run_season,
};
