"""Greedy/heuristic baseline — the performance ceiling the RL agent must match.

Strategy (exploits the game's economics: buys are one-time costs, wages are
charged on the immutable registry roster, and Série A's stronger opponents pay
more gate revenue):

  * Transfer phase: buy the best-overall valid free agent while keeping a cash
    buffer, up to a per-season cap. Stronger squad → more wins → promotion.
  * Tactics: attacking in Série B (chase goals/promotion), balanced in Série A.

Run: PYTHONPATH=. .venv/bin/python baselines/greedy.py --episodes 200
"""

from __future__ import annotations

import argparse
from collections import Counter

import numpy as np

from gandula_env import GandulaCareerEnv
from gandula_env.actions import (
    A_BUY_BASE,
    A_END_TRANSFERS,
    N_AGENTS,
    O_MONEY,
    O_TIER_IS_A,
    agent_overall,
    agent_price,
    tactics_index,
)

CASH_BUFFER = 0.30  # keep ≥300k (1e6 units) after a buy — survives wage dips
MAX_BUYS_PER_SEASON = 99  # effectively uncapped; the buffer limits spend

# Attacking in the climbing tiers (Série B/C — chase goals/promotion), balanced
# once established in Série A.
TACTIC_CLIMB = tactics_index("F433", "Attacking", "Fast", "High", "Wide")
TACTIC_A = tactics_index("F4231", "Balanced", "Normal", "Medium", "Normal")


def greedy_action(obs, mask, buys_this_season: int) -> int:
    in_transfer = obs[0] > 0.5
    if not in_transfer:
        return TACTIC_A if obs[O_TIER_IS_A] > 0.5 else TACTIC_CLIMB

    # Transfer phase: pick the best-overall valid, affordable buy that leaves a
    # buffer; otherwise end the market.
    money = float(obs[O_MONEY])
    best_k, best_ovr = -1, -1.0
    if buys_this_season < MAX_BUYS_PER_SEASON:
        for k in range(N_AGENTS):
            a = A_BUY_BASE + k
            if not mask[a]:
                continue
            p = agent_price(obs, k)
            if money - p < CASH_BUFFER:
                continue
            ovr = agent_overall(obs, k)
            if ovr > best_ovr:
                best_ovr, best_k = ovr, k
    if best_k >= 0:
        return A_BUY_BASE + best_k
    return A_END_TRANSFERS


def run(episodes: int, max_seasons: int, base_seed: int, starter: str) -> None:
    starter_mode: str | int = int(starter) if starter.lstrip("-").isdigit() else starter
    env = GandulaCareerEnv(max_seasons=max_seasons, starter_mode=starter_mode)
    outcomes: Counter[str] = Counter()
    reached_A = 0
    champion_A = 0
    returns = []
    rng = np.random.default_rng(base_seed)

    for _ in range(episodes):
        seed = int(rng.integers(1, 1_000_000))
        obs, info = env.reset(seed=seed)
        done = False
        total = 0.0
        buys = 0
        ever_A = False
        last_in_transfer = True
        while not done:
            mask = env.action_masks()
            in_transfer = obs[0] > 0.5
            # reset per-season buy counter when a fresh transfer phase begins
            if in_transfer and not last_in_transfer:
                buys = 0
            action = greedy_action(obs, mask, buys)
            if A_BUY_BASE <= action < A_BUY_BASE + N_AGENTS:
                buys += 1
            last_in_transfer = in_transfer
            obs, reward, terminated, truncated, info = env.step(action)
            total += reward
            if info.get("tier") == 1:
                ever_A = True
            done = terminated or truncated
        outcome = info.get("outcome", "truncated")
        outcomes[outcome] += 1
        reached_A += int(ever_A)
        champion_A += int(outcome == "champion_A")
        returns.append(total)

    env.close()
    print(f"\nGreedy baseline over {episodes} careers (max_seasons={max_seasons}):")
    print(f"  reached Série A : {reached_A/episodes:6.1%}")
    print(f"  won Série A     : {champion_A/episodes:6.1%}")
    print(f"  fired           : {(outcomes['fired']+outcomes['fired_boundary'])/episodes:6.1%}")
    print(f"  mean return     : {np.mean(returns):7.3f}")
    print(f"  outcome breakdown: {dict(outcomes)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--episodes", type=int, default=100)
    ap.add_argument("--max-seasons", type=int, default=10)
    ap.add_argument("--seed", type=int, default=12345)
    ap.add_argument("--starter", type=str, default="random", help="weakest | random | <team_id>")
    args = ap.parse_args()
    run(args.episodes, args.max_seasons, args.seed, args.starter)
