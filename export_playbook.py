"""Export a trained agent's career decisions for a given seed as a playbook
JSON the Gandula web app's watch mode can replay in the real UI.

Playbook shape:
  { seed, starterId, starterName, maxSeasons,
    seasons: [ { year, tier,
                 transfers: [ {kind:"buy"|"sell", playerId, name, position, price} ],
                 tactics: { formation, tactics:{mentality,tempo,pressing,width},
                            starting_xi:[...11], bench:[...] },
                 result: {...} } ] }

Run: PYTHONPATH=. .venv/bin/python export_playbook.py --seed 4242 --out web-playbook.json
"""

from __future__ import annotations

import argparse
import json

from sb3_contrib import MaskablePPO

from gandula_env import GandulaCareerEnv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="models/maskppo_gandula")
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--max-seasons", type=int, default=10)
    ap.add_argument("--starter", default="random")
    ap.add_argument("--out", default="web-playbook.json")
    args = ap.parse_args()

    starter_mode = int(args.starter) if args.starter.lstrip("-").isdigit() else args.starter
    env = GandulaCareerEnv(max_seasons=args.max_seasons, starter_mode=starter_mode)
    model = MaskablePPO.load(args.model)

    obs, info = env.reset(seed=args.seed, options={"replay": True})
    done = False
    while not done:
        mask = env.action_masks()
        action, _ = model.predict(obs, action_masks=mask, deterministic=True)
        obs, reward, terminated, truncated, info = env.step(int(action))
        done = terminated or truncated

    playbook = env.dump_playbook()
    env.close()

    with open(args.out, "w") as f:
        json.dump(playbook, f, indent=2, ensure_ascii=False)
    n = len(playbook["seasons"])
    print(f"wrote {args.out}: {playbook['starterName']} (seed {playbook['seed']}), {n} seasons")


if __name__ == "__main__":
    main()
