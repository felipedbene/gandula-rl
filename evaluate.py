"""Evaluate a trained MaskablePPO agent over many held-out career seeds and
report win-rate metrics, comparable to baselines/greedy.py.

The policy is reactive: it picks actions from observations + masks, with NO
per-seed search — the rigorous meaning of "an agent that wins."

Run: PYTHONPATH=. .venv/bin/python evaluate.py --model models/maskppo_gandula --episodes 300
"""

from __future__ import annotations

import argparse
from collections import Counter

import numpy as np
from sb3_contrib import MaskablePPO

from gandula_env import GandulaCareerEnv


def evaluate(model_path: str, episodes: int, max_seasons: int, starter: str, seed: int):
    starter_mode: str | int = int(starter) if starter.lstrip("-").isdigit() else starter
    env = GandulaCareerEnv(max_seasons=max_seasons, starter_mode=starter_mode)
    model = MaskablePPO.load(model_path)

    rng = np.random.default_rng(seed)
    outcomes: Counter[str] = Counter()
    reached_A = champion_A = 0
    returns = []

    for _ in range(episodes):
        s = int(rng.integers(1, 1_000_000))
        obs, info = env.reset(seed=s)
        done = False
        total = 0.0
        ever_A = False
        while not done:
            mask = env.action_masks()
            action, _ = model.predict(obs, action_masks=mask, deterministic=True)
            obs, reward, terminated, truncated, info = env.step(int(action))
            total += reward
            if info.get("tier") == 1:
                ever_A = True
            done = terminated or truncated
        outcomes[info.get("outcome", "truncated")] += 1
        reached_A += int(ever_A)
        champion_A += int(info.get("outcome") == "champion_A")
        returns.append(total)

    env.close()
    fired = outcomes["fired"] + outcomes["fired_boundary"]
    print(f"\nMaskablePPO over {episodes} careers (max_seasons={max_seasons}, starter={starter}):")
    print(f"  reached Série A : {reached_A/episodes:6.1%}")
    print(f"  won Série A     : {champion_A/episodes:6.1%}")
    print(f"  fired           : {fired/episodes:6.1%}")
    print(f"  mean return     : {np.mean(returns):7.3f}")
    print(f"  outcome breakdown: {dict(outcomes)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", type=str, default="models/maskppo_gandula")
    ap.add_argument("--episodes", type=int, default=300)
    ap.add_argument("--max-seasons", type=int, default=10)
    ap.add_argument("--starter", type=str, default="random")
    ap.add_argument("--seed", type=int, default=999)
    args = ap.parse_args()
    evaluate(args.model, args.episodes, args.max_seasons, args.starter, args.seed)
