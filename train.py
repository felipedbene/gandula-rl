"""Train a MaskablePPO agent to win Gandula careers.

The action space is a single flat Discrete(578); validity (phase + budget +
roster bounds) is enforced via action masks, so MaskablePPO never proposes an
illegal transfer/tactic.

Run: PYTHONPATH=. .venv/bin/python train.py --timesteps 400000 --n-envs 8
"""

from __future__ import annotations

import argparse
from pathlib import Path

from sb3_contrib import MaskablePPO
from sb3_contrib.common.maskable.policies import MaskableActorCriticPolicy
from sb3_contrib.common.wrappers import ActionMasker
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import SubprocVecEnv, VecMonitor

from gandula_env import GandulaCareerEnv


def _mask_fn(env):
    return env.action_masks()


def make_env(max_seasons: int, starter_mode: str):
    def _init():
        env = GandulaCareerEnv(max_seasons=max_seasons, starter_mode=starter_mode)
        env = ActionMasker(env, _mask_fn)
        return Monitor(env)

    return _init


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--timesteps", type=int, default=400_000)
    ap.add_argument("--n-envs", type=int, default=8)
    ap.add_argument("--max-seasons", type=int, default=10)
    ap.add_argument("--starter", type=str, default="random")
    ap.add_argument("--out", type=str, default="models/maskppo_gandula")
    ap.add_argument("--tb", type=str, default="runs")
    ap.add_argument("--progress", action="store_true")
    args = ap.parse_args()

    venv = SubprocVecEnv([make_env(args.max_seasons, args.starter) for _ in range(args.n_envs)])
    venv = VecMonitor(venv)

    model = MaskablePPO(
        MaskableActorCriticPolicy,
        venv,
        learning_rate=3e-4,
        n_steps=256,
        batch_size=256,
        n_epochs=10,
        gamma=0.997,  # long credit horizon: a title is many seasons away
        gae_lambda=0.95,
        ent_coef=0.01,
        clip_range=0.2,
        policy_kwargs=dict(net_arch=[256, 256]),
        tensorboard_log=args.tb,
        verbose=1,
    )

    model.learn(total_timesteps=args.timesteps, progress_bar=args.progress)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    model.save(str(out))
    venv.close()
    print(f"\nsaved model → {out}.zip")


if __name__ == "__main__":
    main()
