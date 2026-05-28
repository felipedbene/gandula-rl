# gandula_rl

A reinforcement-learning agent that plays **career mode** in
[Gandula](https://gandula.debene.dev) — the deterministic Elifoot-style football
manager — and tries to win it: climb from Série B to Série A, take titles, and
never go broke.

It trains against the **real game**, headless. No browser scraping: the Rust
simulation engine (compiled to WebAssembly) and the actual TypeScript career
logic from the Gandula repo are reused directly, so what the agent learns to
beat *is* the game.

```
┌────────────┐   Discrete(578)   ┌──────────────┐  JSON/stdio  ┌──────────────────────────┐
│ MaskablePPO │ ────────────────▶ │ Gymnasium env │ ───────────▶ │ Node harness (real game) │
│  (PyTorch)  │ ◀──────────────── │  (gandula_env) │ ◀─────────── │  • wasm engine (Rust)    │
└────────────┘  obs(109)+mask     └──────────────┘   obs/reward  │  • web/src/util/* (TS)   │
                                                                  └──────────────────────────┘
```

## How it reuses the real game

---

# Architecture

The system is four layers, each a pure boundary over the one below. Reading
top-down: PyTorch decides, Gymnasium adapts, a Node process is the game, and a
Rust/WASM core is the physics.

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ train.py / evaluate.py / baselines/greedy.py        (Python · PyTorch)     │
 │   MaskablePPO over a flat Discrete(578) action with per-step action masks  │
 └───────────────▲───────────────────────────────────────────┬──────────────┘
   obs(109)+mask │                                 action(int)│
 ┌───────────────┴───────────────────────────────────────────▼──────────────┐
 │ gandula_env/  GandulaCareerEnv : gymnasium.Env             (Python)        │
 │   • owns one Node child per env  • newline-delimited JSON over stdio       │
 │   • action_masks() for MaskablePPO  • SubprocVecEnv → N parallel careers   │
 └───────────────▲───────────────────────────────────────────┬──────────────┘
   {obs,reward,  │                              {cmd:"step",  │
    done,mask}   │                               action}      │
 ┌───────────────┴───────────────────────────────────────────▼──────────────┐
 │ harness/  dist/server.cjs   (one self-contained Node CJS bundle)           │
 │   server.ts   stdio JSON MDP: phase machine (transfer→tactics), reward     │
 │   career.ts   the career loop, calling the REAL gandula web/src/util/*     │
 │   encode.ts   Career → obs features · best-XI · action layout + masking    │
 │   teams-node.ts   Node stand-in for gandula's Vite-only teams.ts           │
 └───────────────▲───────────────────────────────────────────┬──────────────┘
   SeasonRecord, │                            play_match /     │
   Match (JSON)  │                            run_season /     │
                 │                            derive_match_seed│
 ┌───────────────┴───────────────────────────────────────────▼──────────────┐
 │ harness/wasm-node/  gandula_wasm.js + .wasm  (Rust core, wasm-pack nodejs) │
 │   deterministic simulation — byte-identical to the live site & cargo CLI   │
 └────────────────────────────────────────────────────────────────────────────┘
```

## 1. The engine layer (Rust → WASM, reused verbatim)

Gandula's simulation core is a deterministic Rust crate. A match is a pure
function `simulate(home, away, seed)`; a season is `simulate_season(teams, seed)`.
The same crate compiles to WASM and powers the live site. We rebuild it for Node
(`wasm-pack build gandula/wasm --target nodejs`) which emits a CommonJS module
exposing exactly three entry points:

| export | signature | role |
|---|---|---|
| `play_match` | `(home, away, seed) → Match` | one match, with event log |
| `run_season` | `(teams, seed, name) → SeasonRecord` | double round-robin + standings |
| `derive_match_seed` | `(seasonSeed, fixtureIdx) → seed` | per-fixture seed derivation |

**Determinism contract** (the property everything else leans on): identical
inputs ⇒ byte-identical outputs. Seeds cascade `seasonSeed = careerSeed ^ year`,
`divSeed = seasonSeed ^ tier`, `matchSeed = derive_match_seed(divSeed, fixtureIdx)`.
`harness/src/smoke.cjs` reproduces the `cargo` CLI's standings exactly, proving
the Node build is the same engine.

## 2. The harness layer (real career logic, made headless)

Gandula's **career** rules (transfers, finances, aging, youth regen,
promotion/relegation, mid-season re-simulation) are pure TypeScript in
`gandula/web/src/util/*`. Only the React components orchestrate them.
`harness/src/career.ts` reconstructs that orchestration as a `CareerEngine`
class that calls the **same functions** — no reimplementation, so no drift:

- new career → `divideIntoDivisions`, `pickStarterTeam` + two `run_season`s
- tactics → `resimulateFromRound` (re-sims the user's remaining fixtures)
- round advance → `roundCashDelta` (home gate − wage slice), firing check via
  `isManagerFired`
- season end → `computePromotionRelegation` + `advanceCareer` (ages the squad,
  recomposes divisions, simulates next season)

**The bundling trick.** Two of those modules can't run under Node as written, so
`harness/build.mjs` (esbuild) rewrites them at bundle time via an `onResolve`
plugin — **without editing the gandula repo**:

1. `../wasm/gandula_wasm.js` (web build, async `fetch` init) → our Node build,
   kept *external* so its `__dirname` finds the companion `.wasm`.
2. `../teams` (Vite `import.meta.glob`) → `harness/src/teams-node.ts`, which
   reads the same team JSONs via `fs` and exposes an identical `ALL_TEAMS`.

`idb` (pulled in by `persistence.ts`) bundles fine and is never invoked. The
output is one self-contained `dist/server.cjs`.

## 3. The MDP layer (server.ts)

`server.ts` turns the career into a turn-based MDP over stdio. Each `step` is one
atomic decision; the env auto-runs everything between decisions.

**Episode = one career** (up to `--max-seasons` seasons). Per season two phases
alternate:

```
reset → ┌─ TRANSFER ─┐  end    ┌─ TACTICS ─┐  setTactics + play whole season
        │ buy / sell │ ──────▶ │ 1 of 540  │ ───────────────────────────────┐
        └────────────┘         └───────────┘                                 │
              ▲                              advanceSeason (P/R, age, re-sim) │
              └──────────────────────────────────────────────────────────────┘
   terminal: fired (−5) · won Série A (+10) · truncated at season cap
```

**Action space — flat `Discrete(578)`**, regions selected by a per-step boolean
mask (so MaskablePPO never emits an illegal move):

| range | meaning | valid when |
|---|---|---|
| `0…539` | tactics = formation(4)×mentality(5)×tempo(3)×pressing(3)×width(3) | tactics phase |
| `540…551` | buy free-agent *i* (pool of 12) | transfer phase · affordable · not owned |
| `552…576` | sell roster slot *j* (by id order, ≤25) | transfer phase · not in XI · roster>14 |
| `577` | end the market | transfer phase (always) |

The starting XI is auto-picked (best 11 by overall, 1 GK guaranteed) so bought
players actually play; learned XI selection is a noted extension.

**Observation — 109 floats** (`encode.ts buildObs`, normalized):
phase one-hot, tier, year, money, projected wage bill, squad meta-strength
(attack/midfield/defense via the engine's documented formula on the best XI),
roster size, per-position depth (count/best/avg overall ×4), last-season
(position/points/outcome), and the 12 free agents (overall, position one-hot,
price, affordability) ×7.

**Reward** — shaped per season `+0.02·points + 0.2·(season cash Δ / 1e6)`, plus
terminal **+3 promotion**, **−2 relegation**, **+10 Série A title**, **−5 fired**.
(Tunables at the top of `server.ts`.)

## 4. The RL layer (Python)

`gandula_env/env.py` is a `gymnasium.Env` that spawns one `server.cjs` child and
relays `reset`/`step` as JSON lines. `action_masks()` feeds MaskablePPO; many
envs run in parallel under `SubprocVecEnv` (each its own Node career). `train.py`
wraps each env in `ActionMasker` + `Monitor` and trains
`MaskablePPO` (MLP `[256,256]`, `γ=0.997` for the long, many-season credit
horizon). `gandula_env/actions.py` mirrors the action/observation layout for the
baseline and tooling.

## Why this is hard (and why RL helps)

The economy is unforgiving. Free-agent prices scale with overall² (an ~80-rated
player costs ~640k–960k of a 1M start), wages are charged on squad strength, and
Série A's stronger opponents pay *more* gate revenue. The agent must jointly
chase promotion **and** stay solvent — overspend and you're fired; hoard and you
never climb. The greedy baseline reaches Série A often but bankrupts itself; a
learned policy has to balance both.

## "Wins every time", honestly

The engine is deterministic and its formulas are public, so per-match tactics are
*searchable*. We therefore treat a **greedy/heuristic policy as the ceiling** and
require the **learned policy to beat it on held-out seeds with no per-seed
search** — a reactive policy reading only observation + mask. Success is reported
as **win-rate over many random career seeds** (see `RESULTS.md`).

## Setup

Prereqs: `rustup` (with the `wasm32-unknown-unknown` target), `wasm-pack`,
Node 20+, and `uv`. Then:

```bash
./scripts/setup.sh        # builds the Node wasm engine + harness bundle + Python venv
```

## Use

```bash
PYTHONPATH=. .venv/bin/python scripts/check_env.py                 # validate the env contract
PYTHONPATH=. .venv/bin/python baselines/greedy.py  --episodes 200  # heuristic baseline
PYTHONPATH=. .venv/bin/python train.py --timesteps 600000 --n-envs 8
PYTHONPATH=. .venv/bin/python evaluate.py --episodes 300           # held-out win-rate
```

`--starter` selects difficulty: `random` (website-faithful, the default),
`weakest` (the deterministic weakest Série B club — hardest), or a team id.

## Watch the agent play

Two ways to see a trained career unfold.

**1. Terminal replay** — narrates one career (club, transfers + fees, tactics,
round results, final table, promotions/titles), in colour:

```bash
PYTHONPATH=. .venv/bin/python replay.py --model models/maskppo_gandula --seed 4242
```

**2. In the real website (watch mode).** Export the agent's decisions for a seed
as a playbook, then load it in the actual Gandula web app and watch the career
auto-play in the real UI:

```bash
PYTHONPATH=. .venv/bin/python export_playbook.py --seed 4242 --out web-playbook.json
# then, in the gandula repo:
cd ../gandula && ./scripts/build-web.sh && (cd web && npm run dev)
# open http://localhost:5173 → "👁 Carregar playbook (IA)" → pick web-playbook.json
```

The web side is a small, opt-in addition to the Gandula app (no change to the
normal game): `web/src/util/watch-playbook.ts` replays the playbook through the
**same** engine + career functions the game uses (so it reproduces the agent's
career exactly), and `web/src/components/WatchView.tsx` auto-plays it with
play/pause/speed/skip. A shared `util/new-career.ts` is reused by both the normal
"Nova carreira" flow and watch mode. Covered by the gandula test suite
(`watch-playbook.test.ts`, `WatchView.test.tsx`).

## Layout

```
harness/                 Node bridge to the real game
  wasm-node/             wasm-pack --target nodejs build (gitignored)
  src/career.ts          headless career loop (reuses gandula web/src/util/*)
  src/encode.ts          observation features, best-XI, action layout + masking
  src/server.ts          stdio JSON MDP server (reset/step) + reward shaping
  src/teams-node.ts      Node replacement for gandula's Vite-only teams.ts
  build.mjs              esbuild bundle + import redirects
gandula_env/             Gymnasium env (spawns the Node server, JSON-lines IPC)
baselines/greedy.py      heuristic ceiling
train.py / evaluate.py   MaskablePPO training + held-out evaluation
replay.py                terminal career narration of a trained agent
export_playbook.py       dump an agent career → playbook JSON for web watch mode
```

The website watch mode lives in the **gandula** repo (small, opt-in):
`web/src/util/{new-career,watch-playbook}.ts`, `web/src/components/WatchView.tsx`,
plus a playbook loader on the "Nova carreira" screen of `SeasonView.tsx`.

## Results

See `RESULTS.md` (generated by an evaluation run). Summary is filled in there
after training; reproduce with the commands above.

## License

MIT — see [LICENSE](LICENSE).

## Not done (deliberately)
- A shim that drives the live gandula.debene.dev React/IndexedDB app. The trained
  policy is engine-portable, so this is a thin add-on, left out per scope.
- XI selection as a learned action (currently a best-by-overall heuristic).
