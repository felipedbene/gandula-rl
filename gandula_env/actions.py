"""Action layout + observation offsets — mirror of harness/src/encode.ts.

Keep in sync with the TypeScript side. The harness is the source of truth for
the actual game effects; this module only helps Python construct/interpret
actions and read observation features.
"""

FORMATIONS = ["F442", "F433", "F352", "F4231"]
MENTALITIES = ["VeryDefensive", "Defensive", "Balanced", "Attacking", "VeryAttacking"]
TEMPOS = ["Slow", "Normal", "Fast"]
PRESSINGS = ["Low", "Medium", "High"]
WIDTHS = ["Narrow", "Normal", "Wide"]
POSITIONS = ["GK", "DEF", "MID", "FWD"]

N_TACTICS = len(FORMATIONS) * len(MENTALITIES) * len(TEMPOS) * len(PRESSINGS) * len(WIDTHS)  # 540
N_AGENTS = 12
MAX_ROSTER_SLOTS = 25

A_TACTICS_BASE = 0
A_BUY_BASE = N_TACTICS
A_SELL_BASE = A_BUY_BASE + N_AGENTS
A_END_TRANSFERS = A_SELL_BASE + MAX_ROSTER_SLOTS
ACTION_DIM = A_END_TRANSFERS + 1  # 578


def tactics_index(formation: str, mentality: str, tempo: str, pressing: str, width: str) -> int:
    f = FORMATIONS.index(formation)
    m = MENTALITIES.index(mentality)
    te = TEMPOS.index(tempo)
    pr = PRESSINGS.index(pressing)
    w = WIDTHS.index(width)
    return ((((f * len(MENTALITIES) + m) * len(TEMPOS) + te) * len(PRESSINGS) + pr) * len(WIDTHS) + w)


# ---- observation offsets (see harness/src/encode.ts buildObs) --------------
# E.6 layout (OBS_DIM 115): 3-tier one-hot + economy substrate added.
O_PHASE_TRANSFER = 0
O_PHASE_TACTICS = 1
O_TIER_IS_A = 2
O_TIER_IS_B = 3
O_TIER_IS_C = 4
O_YEAR = 5
O_MONEY = 6
O_SALARY = 7
O_ATTACK = 8
O_MID = 9
O_DEF = 10
O_ROSTER_SIZE = 11
O_FANBASE = 12
O_STADIUM = 13
O_MOMENTUM = 14
O_SPONSORSHIP = 15
O_POS_SUMMARY = 16  # 4 positions x (count, best, avg)
O_LAST = 28  # position, points, outcome
O_AGENTS = 31  # 12 agents x (overall, isGK, isDEF, isMID, isFWD, price, affordable)
AGENT_STRIDE = 7


def agent_overall(obs, k: int) -> float:
    return float(obs[O_AGENTS + AGENT_STRIDE * k + 0])


def agent_price(obs, k: int) -> float:
    return float(obs[O_AGENTS + AGENT_STRIDE * k + 5])
