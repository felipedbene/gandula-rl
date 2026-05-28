"""Gymnasium environment wrapping the headless Gandula career harness.

Each env owns a Node child process (harness/dist/server.cjs) and talks to it
over newline-delimited JSON. One episode = one career: alternating transfer /
tactics decisions across up to `max_seasons` seasons. Terminal on winning
Série A (objective) or getting fired; truncated at the season cap.

The action space is a single flat Discrete(578); validity depends on the
current phase, exposed via `action_masks()` for MaskablePPO.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

HARNESS_DIR = Path(__file__).resolve().parent.parent / "harness"
SERVER_JS = HARNESS_DIR / "dist" / "server.cjs"

ACTION_DIM = 578
OBS_DIM = 109


class GandulaCareerEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        max_seasons: int = 8,
        seed_pool: tuple[int, int] = (1, 1_000_000),
        starter_mode: str | int = "random",
    ):
        super().__init__()
        self.max_seasons = max_seasons
        self.seed_lo, self.seed_hi = seed_pool
        # "weakest" (deterministic hardest), "random" (website-faithful, seeded),
        # or an int team id (fixed club).
        self.starter_mode = starter_mode

        self.action_space = spaces.Discrete(ACTION_DIM)
        # Features are normalized to roughly [-1, 3]; money can drift higher, so
        # give generous bounds.
        self.observation_space = spaces.Box(
            low=-10.0, high=20.0, shape=(OBS_DIM,), dtype=np.float32
        )

        self._proc: subprocess.Popen[str] | None = None
        self._mask = np.ones(ACTION_DIM, dtype=bool)
        self._rng = np.random.default_rng()
        self._start_proc()

    # ---- subprocess plumbing ------------------------------------------------
    def _start_proc(self) -> None:
        node = shutil.which("node")
        if node is None:
            raise RuntimeError("`node` not found on PATH")
        if not SERVER_JS.exists():
            raise RuntimeError(
                f"{SERVER_JS} missing — run `cd harness && node build.mjs` first"
            )
        self._proc = subprocess.Popen(
            [node, str(SERVER_JS)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd=str(HARNESS_DIR),
        )

    def _send(self, obj: dict[str, Any]) -> dict[str, Any]:
        assert self._proc is not None and self._proc.stdin and self._proc.stdout
        self._proc.stdin.write(json.dumps(obj) + "\n")
        self._proc.stdin.flush()
        line = self._proc.stdout.readline()
        if not line:
            err = self._proc.stderr.read() if self._proc.stderr else ""
            raise RuntimeError(f"harness died: {err}")
        msg = json.loads(line)
        if "error" in msg:
            raise RuntimeError(f"harness error: {msg['error']}\n{msg.get('stack', '')}")
        return msg

    # ---- gym API ------------------------------------------------------------
    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        if seed is not None:
            self._rng = np.random.default_rng(seed)
        career_seed = int(self._rng.integers(self.seed_lo, self.seed_hi))
        if options and "career_seed" in options:
            career_seed = int(options["career_seed"])
        payload: dict[str, Any] = {
            "cmd": "reset",
            "seed": career_seed,
            "max_seasons": self.max_seasons,
        }
        # Starter selection: explicit option wins, else the env's mode.
        starter = (options or {}).get("starter", self.starter_mode)
        if starter == "random":
            payload["starter"] = "random"
        elif starter not in (None, "weakest"):
            payload["starter"] = int(starter)
        if (options or {}).get("replay"):
            payload["replay"] = True
        msg = self._send(payload)
        self._mask = np.asarray(msg["mask"], dtype=bool)
        obs = np.asarray(msg["obs"], dtype=np.float32)
        info = dict(msg.get("info", {}))
        info["career_seed"] = career_seed
        return obs, info

    def step(self, action: int):
        msg = self._send({"cmd": "step", "action": int(action)})
        self._mask = np.asarray(msg["mask"], dtype=bool)
        obs = np.asarray(msg["obs"], dtype=np.float32)
        reward = float(msg.get("reward", 0.0))
        done = bool(msg.get("done", False))
        info = dict(msg.get("info", {}))
        truncated = done and bool(info.get("truncated", False))
        terminated = done and not truncated
        return obs, reward, terminated, truncated, info

    # ---- MaskablePPO hook ---------------------------------------------------
    def action_masks(self) -> np.ndarray:
        return self._mask.copy()

    # ---- replay / watch-mode export -----------------------------------------
    def dump_playbook(self) -> dict[str, Any]:
        """Return the recorded decisions of the current career (seed, starter,
        per-season tactics + transfers) for the web app's watch mode."""
        return self._send({"cmd": "dump"})["playbook"]

    def close(self) -> None:
        if self._proc is not None:
            try:
                if self._proc.stdin:
                    self._proc.stdin.write(json.dumps({"cmd": "close"}) + "\n")
                    self._proc.stdin.flush()
                self._proc.wait(timeout=2)
            except Exception:
                self._proc.kill()
            finally:
                self._proc = None

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass
