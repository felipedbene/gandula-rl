# Results

## E.6 — re-measure after the E.2–E.4 redesign (3-tier world + full economy)

The game changed massively since the runs below: **3-tier pyramid** (start in
Série C now, so reaching Série A needs TWO promotions), **Copa do Brasil**, and
a **full economy** (TV floor by tier, match/placement/cup prizes, stadium +
marketing + sponsorship, team form, rare-elite free agents). The harness was
ported to this v9 world (see harness/src/career.ts + the 115-dim obs) and
re-measured.

**Greedy baseline vs the NEW economy** (200 careers, ≤10 seasons, random Série C
starter):

| metric            | NEW economy (greedy) | OLD 2-tier (greedy, below) |
|-------------------|:--------------------:|:--------------------------:|
| reached Série A   |      **88.5%**       |           61.7%            |
| won Série A title |      **21.5%**       |            1.3%            |
| **manager fired** |      **0.0%**        |           58.0%            |
| mean return       |        25.98         |            0.44            |

**Finding: the E.4 economy decisively broke the old broke/title walls — and
overshot.** Firing went to **0%** (a *greedy* agent is now essentially
unfireable) and the title rate hit **21.5%** for greedy, from the *harder*
3-tier start in *half* the horizon. The floors (TV + sponsorship) + the
flywheel (placement/cup prizes) + the rare-elite market all work — too well.

### Re-tune pass (floors pulled down)

Lowered the structural floors in `gandula/web/src/util/finances.ts`:
`TV_DEAL_BY_TIER` C/B/A 600k/1.5M/4M → **300k/900k/3M**; `SPONSORSHIP_BASE_BY_TIER`
200k/500k/1.2M → **100k/300k/800k**; `SPONSORSHIP_FANBASE_COEF` 4 → **2.5**;
`PLACEMENT_PRIZE_BASE` 2.5M → **1.5M**.

**Greedy vs the RE-TUNED economy** (200 careers, ≤10 seasons):

| metric            | original E.4 | **re-tuned** |
|-------------------|:------------:|:------------:|
| reached Série A   |    88.5%     |  **86.0%**   |
| won Série A title |    21.5%     |  **23.0%**   |
| manager fired     |     0.0%     |  **0.0%**    |
| mean return       |    25.98     |  **23.72**   |

**The floor cut barely moved the needle** (still 0% fired). The reason: a greedy
manager's income is dominated by **matchday (stadium × fanbase) + match/Copa
bonuses + the cheap rare-elite market**, not the structural floors that were cut.
So solvency is still essentially automatic. **Decision: accept the generous
economy as the intended design** (zero-bankruptcy, title reachable) rather than
chase a "solvency-as-skill" target — making firing bite again would mean cutting
matchday/bonus income, a deeper rebalance not worth it now. The re-tune is kept
(a modestly leaner economy); the headline win stands: **the redesign broke the
old broke-91% / title-4.7% walls.**

### Trained policy (MaskablePPO, 300k steps, re-tuned economy)

A short **confirmation** run (300k steps, 8 envs) — not a converged policy
(`models/maskppo_e6`, 200 careers, random Série C starter):

| metric            | greedy | PPO · 300k |
|-------------------|:------:|:----------:|
| reached Série A   | 86.0%  |   22.0%    |
| won Série A title | 23.0%  |    0.0%    |
| manager fired     |  0.0%  |    0.0%    |
| mean return       | 23.72  |   16.47    |

The 300k agent **under-performs greedy** — expected: the new 3-tier world is much
larger (reaching A needs two promotions) and 300k is far short of convergence
(the historical 2-tier runs needed ~2M; outcome breakdown here is
mostly `stayed`, i.e. it barely buys/promotes yet). What it **does** confirm is
the headline: even a half-trained policy is **never fired (0%)** — the economy's
no-bankruptcy floor is robust. A converged (1–2M-step) policy would be needed to
re-approach greedy's promotion/title numbers; deferred (the balance conclusion
doesn't depend on it).

---

# (historical) pre-E.4 results — 2-tier world, started in Série B

Held-out evaluation: each agent runs on career seeds it never trained on, with
**no per-seed search** — a reactive policy reading only the observation + action
mask. Metrics are over 300 careers (random Série B starter, ≤10 seasons), same
seed stream across agents.

## Trained agent vs. greedy baseline (random starter, 300 careers)

| metric            | greedy (heuristic) | PPO · 600k steps | **PPO · 2M steps** |
|-------------------|:------------------:|:----------------:|:------------------:|
| reached Série A   |       61.7%        |      71.7%       |     **72.0%**      |
| won Série A title |        1.3%        |       1.3%       |      **2.7%**      |
| **manager fired** |     **58.0%**      |     **23.3%**    |     **0.0%**       |
| mean return       |        0.44        |       4.16       |     **5.41**       |

The learned policy solves the thing the greedy heuristic never balances —
**chase promotion while staying solvent** — and training longer sharpens it
dramatically:

- **Firing 58% → 23% → 0%.** The 2M-step agent went broke in **0 of 300**
  careers. It learned to size transfers to the (strength-scaled) wage bill and
  keep a buffer through away-heavy stretches, instead of spending to a fixed
  floor like greedy.
- **Promotion ~72%** to Série A from a random Série B club.
- **Série A title 1.3% → 2.7%** — doubled by the longer run, but still the hard
  frontier (see below).

## Hard mode — weakest Série B club (deterministic, 200 careers)

| metric          | greedy | PPO · 2M |
|-----------------|:------:|:--------:|
| reached Série A |  3.3%  | **6.0%** |
| manager fired   |  0.0%  |   0.0%   |
| mean return     |  2.70  | **2.78** |

From the league's weakest club the climb is genuinely capped by the economy (an
~80-rated free agent costs most of the 1M start; operations roughly break even).
The agent stays safe (0% fired) and ~doubles greedy's promotion rate, but a title
in ≤10 seasons from the bottom is near the reachable ceiling.

## Reading the numbers

- **Promotion + survival is solved.** The 2M agent never gets fired and reaches
  Série A in ~72% of random careers — "beating the game" in the sense most
  players mean it. Training from 600k → 2M steps drove firing to **zero**.
- **Winning the Série A title is the remaining frontier (2.7%).** A title needs a
  much stronger squad than a tight 10-season economy easily affords, and the +10
  title reward is sparse. Levers to push it higher: more steps, reward shaping
  toward Série A league position, and making the starting XI a learned action
  rather than a best-by-overall heuristic.

## Reproduce

```bash
# the headline 2M model (~40 min, CPU, 8 envs):
PYTHONPATH=. .venv/bin/python train.py --timesteps 2000000 --n-envs 8 --out models/maskppo_gandula_long
PYTHONPATH=. .venv/bin/python evaluate.py --model models/maskppo_gandula_long --episodes 300 --starter random
PYTHONPATH=. .venv/bin/python baselines/greedy.py --episodes 300 --starter random
```

A 600k-step run (~12 min) already reaches the promotion/survival numbers above;
the 2M run is what drives firing to zero and doubles the title rate. The engine's
determinism means a fixed seed reproduces a career exactly — see `replay.py` and
the web watch mode (README) to watch one unfold.
