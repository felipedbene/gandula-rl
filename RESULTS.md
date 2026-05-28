# Results

Held-out evaluation: each agent is run on career seeds it never trained on, with
**no per-seed search** — a reactive policy reading only the observation + action
mask. Metrics are over 300 careers (random Série B starter, ≤10 seasons), same
seed stream for both agents.

## Trained agent vs. greedy baseline (random starter, 300 careers)

| metric            | greedy (ceiling heuristic) | **MaskablePPO (learned)** |
|-------------------|:--------------------------:|:-------------------------:|
| reached Série A   |           61.7%            |          **71.7%**        |
| won Série A title |            1.3%            |            1.3%           |
| **manager fired** |          **58.0%**         |          **23.3%**        |
| mean return       |            0.44            |          **4.16**         |

The learned policy more than halves the firing rate (58% → 23%), lifts promotion
~10 points, and ~10×'s mean return. It learned the thing the greedy heuristic
never balances: **chase promotion while staying solvent** — sizing transfers to
the wage bill instead of spending to a fixed buffer.

## Hard mode — weakest Série B club (deterministic, 200 careers)

| metric          | greedy | MaskablePPO |
|-----------------|:------:|:-----------:|
| reached Série A |  3.3%  |   **7.0%**  |
| manager fired   |  0.0%  |     0.5%    |
| mean return     |  2.70  |   **2.80**  |

Starting from the league's weakest club, climbing is genuinely capped by the
economy (an ~80-rated free agent costs most of the 1M start; operations roughly
break even). The agent stays safe and ~doubles the promotion rate, but a title
in ≤10 seasons from the bottom is near the ceiling of what's reachable.

## Reading the numbers

- **Promotion + survival** is solved well: the agent reliably reaches Série A
  without going broke — "beating the game" in the sense most players mean it.
- **Winning the Série A title** remains the hard frontier (~1%). It needs a much
  stronger squad than 10 seasons of a tight economy easily affords, and the +10
  title reward is sparse. Levers to push it higher: longer training (1–3M steps),
  reward shaping toward Série A league position, and making the starting XI a
  learned action rather than a best-by-overall heuristic.

## Reproduce

```bash
PYTHONPATH=. .venv/bin/python train.py --timesteps 600000 --n-envs 8
PYTHONPATH=. .venv/bin/python evaluate.py --episodes 300 --starter random
PYTHONPATH=. .venv/bin/python baselines/greedy.py --episodes 300 --starter random
```

Numbers above are from a 600k-step run (~12 min, CPU, 8 envs). Determinism of the
underlying engine means a fixed seed reproduces a career exactly.
