"""Watch the trained agent play one career, narrated in the terminal.

Runs the policy on a single seed with the env in replay mode (the harness emits
rich per-step events) and prints the career unfolding: club, transfers with fees,
tactics chosen, final table, money, promotions/titles.

Run: PYTHONPATH=. .venv/bin/python replay.py --model models/maskppo_gandula --seed 4242
"""

from __future__ import annotations

import argparse

from sb3_contrib import MaskablePPO

from gandula_env import GandulaCareerEnv

GREEN = "\033[32m"
RED = "\033[31m"
YEL = "\033[33m"
CYAN = "\033[36m"
DIM = "\033[2m"
BOLD = "\033[1m"
RST = "\033[0m"


def money(m) -> str:
    return f"{int(m):,}".replace(",", ".")


def print_event(ev: dict) -> None:
    kind = ev.get("kind")
    if kind == "buy":
        print(f"    {GREEN}↳ COMPRA{RST} {ev['name']} ({ev['position']}, ovr {ev['overall']}) "
              f"por {money(ev['price'])}  · caixa {money(ev['money'])}")
    elif kind == "sell":
        print(f"    {YEL}↳ VENDA {RST} {ev['name']} ({ev['position']}) "
              f"por {money(ev['price'])}  · caixa {money(ev['money'])}")
    elif kind == "end_market":
        print(f"    {DIM}↳ mercado fechado{RST}")


def print_season_result(info: dict) -> None:
    tier = "A" if info.get("tier") == 1 else "B"
    print(f"  {CYAN}tática{RST} {info.get('tactics','?')}")
    standings = info.get("standings", [])
    if standings:
        print(f"  {BOLD}Série {tier} — {info.get('year')}{RST}")
        for r in standings:
            mark = f"{BOLD}>{RST}" if r["user"] else " "
            name = (f"{BOLD}{r['team']}{RST}" if r["user"] else r["team"])
            gd = f"+{r['gd']}" if r["gd"] >= 0 else str(r["gd"])
            print(f"   {mark} {r['pos']:>2}. {name:<28} {r['pts']:>3} pts  ({gd})")
    oc = info.get("outcome")
    tag = {
        "promoted": f"{GREEN}↑ PROMOVIDO{RST}",
        "relegated": f"{RED}↓ REBAIXADO{RST}",
        "champion_A": f"{GREEN}{BOLD}🏆 CAMPEÃO DA SÉRIE A{RST}",
        "stayed": "permanece",
        "fired": f"{RED}{BOLD}✗ DEMITIDO{RST}",
        "fired_boundary": f"{RED}{BOLD}✗ DEMITIDO (saldo){RST}",
    }.get(oc, oc or "")
    print(f"  → {tag}   · caixa {money(info.get('money', 0))}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="models/maskppo_gandula")
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--max-seasons", type=int, default=10)
    ap.add_argument("--starter", default="random")
    args = ap.parse_args()

    starter_mode = int(args.starter) if args.starter.lstrip("-").isdigit() else args.starter
    env = GandulaCareerEnv(max_seasons=args.max_seasons, starter_mode=starter_mode)
    model = MaskablePPO.load(args.model)

    obs, info = env.reset(seed=args.seed, options={"replay": True})
    print(f"\n{BOLD}══ Carreira (seed {args.seed}) ══{RST}")
    print(f"Clube: {BOLD}{info.get('starter')}{RST}  ·  Série {'A' if info.get('tier')==1 else 'B'}\n")

    done = False
    while not done:
        mask = env.action_masks()
        action, _ = model.predict(obs, action_masks=mask, deterministic=True)
        obs, reward, terminated, truncated, info = env.step(int(action))
        if "event" in info:
            print_event(info["event"])
        if "tactics" in info or info.get("outcome") in ("fired", "fired_boundary"):
            print_season_result(info)
        done = terminated or truncated

    print(f"{DIM}fim da carreira — {info.get('outcome','?')}{RST}")
    env.close()


if __name__ == "__main__":
    main()
