"""Validate the Gymnasium env contract and that action masks are respected.

Run: .venv/bin/python scripts/check_env.py
"""

import numpy as np
from gymnasium.utils.env_checker import check_env

from gandula_env import GandulaCareerEnv


def masked_rollout(env, episodes=5, seed=0):
    rng = np.random.default_rng(seed)
    results = []
    for ep in range(episodes):
        obs, info = env.reset(seed=int(rng.integers(0, 1_000_000)))
        assert env.observation_space.contains(obs), "obs out of bounds at reset"
        done = False
        steps = 0
        total = 0.0
        while not done and steps < 2000:
            mask = env.action_masks()
            valid = np.flatnonzero(mask)
            assert valid.size > 0, "no valid actions!"
            action = int(rng.choice(valid))
            obs, reward, terminated, truncated, info = env.step(action)
            assert env.observation_space.contains(obs), f"obs out of bounds: {obs.min()},{obs.max()}"
            total += reward
            done = terminated or truncated
            steps += 1
        results.append((info.get("outcome", "?"), round(total, 3), steps))
    return results


def main():
    env = GandulaCareerEnv(max_seasons=8)

    # 1. gymnasium structural check (random unmasked actions; env must not crash
    #    and must keep obs in-bounds).
    print("running gymnasium check_env ...")
    check_env(env, skip_render_check=True)
    print("  check_env OK")

    # 2. masked random rollouts — exercises the real decision flow.
    print("masked random rollouts:")
    for outcome, ret, steps in masked_rollout(env, episodes=8):
        print(f"  outcome={outcome:16s} return={ret:8.3f} steps={steps}")

    env.close()
    print("\nenv contract OK")


if __name__ == "__main__":
    main()
