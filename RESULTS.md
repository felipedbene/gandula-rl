# Results

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
