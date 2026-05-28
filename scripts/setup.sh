#!/usr/bin/env bash
# One-time setup for gandula_rl: build the Node engine + harness bundle and the
# Python RL environment. Run from the gandula_rl repo root.
set -euo pipefail

cd "$(dirname "$0")/.."
GANDULA="${GANDULA:-/Users/felipe/Projects/gandula}"

# Prefer the rustup toolchain (Homebrew rustc lacks the wasm32 target).
export PATH="$HOME/.cargo/bin:$PATH"

echo "==> 1/4 Building the Gandula engine for Node (wasm-pack --target nodejs)"
wasm-pack build "$GANDULA/wasm" --target nodejs --out-dir "$PWD/harness/wasm-node"

echo "==> 2/4 Installing harness npm deps"
(cd harness && npm install --no-fund --no-audit)

echo "==> 3/4 Bundling the headless harness (esbuild)"
(cd harness && node build.mjs)

echo "==> 4/4 Creating the Python venv + installing deps"
uv venv --python 3.10
uv pip install \
  "gymnasium>=0.29" "numpy>=1.26,<2.1" \
  "stable-baselines3>=2.3" "sb3-contrib>=2.3" \
  "torch>=2.2" "tensorboard>=2.16"

cat <<'EOF'

Setup complete. Next:
  PYTHONPATH=. .venv/bin/python scripts/check_env.py          # validate env
  PYTHONPATH=. .venv/bin/python baselines/greedy.py           # baseline
  PYTHONPATH=. .venv/bin/python train.py --timesteps 600000   # train
  PYTHONPATH=. .venv/bin/python evaluate.py --episodes 300    # evaluate

If you change anything in gandula/core or gandula/wasm, re-run this script
(or just steps 1 + 3) to rebuild the engine + bundle.
EOF
