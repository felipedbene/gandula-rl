// Observation / action encoding shared by the stdio server (and mirrored in
// Python gandula_env/spaces.py). Keep the action layout + enum orders in sync
// with the Python side.

import { playerOverall } from "/Users/felipe/Projects/gandula/web/src/util/transfer-market";
import type { Player, Team, UserTactics } from "/Users/felipe/Projects/gandula/web/src/types";
import type { CareerEngine } from "./career";

// ---- enum orders (index ↔ value) ------------------------------------------
export const FORMATIONS = ["F442", "F433", "F352", "F4231"] as const;
export const MENTALITIES = ["VeryDefensive", "Defensive", "Balanced", "Attacking", "VeryAttacking"] as const;
export const TEMPOS = ["Slow", "Normal", "Fast"] as const;
export const PRESSINGS = ["Low", "Medium", "High"] as const;
export const WIDTHS = ["Narrow", "Normal", "Wide"] as const;
export const POSITIONS = ["GK", "DEF", "MID", "FWD"] as const;

// ---- action layout (single flat Discrete) ---------------------------------
export const N_TACTICS =
  FORMATIONS.length * MENTALITIES.length * TEMPOS.length * PRESSINGS.length * WIDTHS.length; // 540
export const N_AGENTS = 12; // free-agent pool size (POOL_SIZE)
export const MAX_ROSTER_SLOTS = 25; // MAX_ROSTER

export const A_TACTICS_BASE = 0; // [0, 540)
export const A_BUY_BASE = N_TACTICS; // [540, 552)
export const A_SELL_BASE = A_BUY_BASE + N_AGENTS; // [552, 577)
export const A_END_TRANSFERS = A_SELL_BASE + MAX_ROSTER_SLOTS; // 577
export const ACTION_DIM = A_END_TRANSFERS + 1; // 578

export type Phase = "transfer" | "tactics";

/** Decode a tactics action index into the five knobs (mixed radix). */
export function decodeTactics(idx: number): {
  formation: UserTactics["formation"];
  mentality: UserTactics["tactics"]["mentality"];
  tempo: UserTactics["tactics"]["tempo"];
  pressing: UserTactics["tactics"]["pressing"];
  width: UserTactics["tactics"]["width"];
} {
  let r = idx;
  const w = r % WIDTHS.length; r = Math.floor(r / WIDTHS.length);
  const pr = r % PRESSINGS.length; r = Math.floor(r / PRESSINGS.length);
  const te = r % TEMPOS.length; r = Math.floor(r / TEMPOS.length);
  const m = r % MENTALITIES.length; r = Math.floor(r / MENTALITIES.length);
  const f = r % FORMATIONS.length;
  return {
    formation: FORMATIONS[f],
    mentality: MENTALITIES[m],
    tempo: TEMPOS[te],
    pressing: PRESSINGS[pr],
    width: WIDTHS[w],
  };
}

// ---- best XI ---------------------------------------------------------------
/** Pick exactly 11 (1 best GK + 10 best outfielders by overall) and a bench of
 *  the next 7. Ensures bought stars actually play. Engine only requires 11
 *  unique XI + ≤7 bench from the roster — no position-shape constraint. */
export function bestEleven(roster: Player[]): { starting_xi: number[]; bench: number[] } {
  const byOverall = (a: Player, b: Player) => playerOverall(b) - playerOverall(a);
  const gks = roster.filter((p) => p.position === "GK").sort(byOverall);
  // One keeper (if any), then fill the remaining 10 slots from everyone else
  // by overall — including surplus keepers, so a GK-heavy roster still yields a
  // full XI of 11. Engine requires exactly 11 unique; no position-shape rule.
  const xi: Player[] = [];
  if (gks.length > 0) xi.push(gks[0]);
  const chosen = new Set(xi.map((p) => p.id));
  const rest = roster.filter((p) => !chosen.has(p.id)).sort(byOverall);
  for (const p of rest) {
    if (xi.length >= 11) break;
    if (chosen.has(p.id)) continue; // guard against duplicate ids in roster
    xi.push(p);
    chosen.add(p.id);
  }
  const bench = roster
    .filter((p) => !chosen.has(p.id))
    .sort(byOverall)
    .slice(0, 7);
  return { starting_xi: xi.map((p) => p.id), bench: bench.map((p) => p.id) };
}

// ---- squad meta-strength (ARCHITECTURE.md formulas, for features only) -----
const ATT_W: Record<string, number> = { GK: 0, DEF: 0.1, MID: 0.3, FWD: 0.6 };
const MID_W: Record<string, number> = { GK: 0, DEF: 0.2, MID: 0.6, FWD: 0.2 };
const DEF_W: Record<string, number> = { GK: 0.1, DEF: 0.6, MID: 0.3, FWD: 0 };

function attackAttr(p: Player) {
  const a = p.attributes;
  return 0.5 * a.finishing + 0.3 * a.technique + 0.2 * a.pace;
}
function midAttr(p: Player) {
  const a = p.attributes;
  return 0.5 * a.passing + 0.3 * a.technique + 0.2 * a.stamina;
}
function defAttr(p: Player) {
  const a = p.attributes;
  return 0.5 * a.defending + 0.2 * a.pace + 0.3 * a.stamina;
}

export function squadStrength(xi: Player[]): { attack: number; midfield: number; defense: number } {
  const wsum = (w: Record<string, number>) => xi.reduce((s, p) => s + (w[p.position] ?? 0), 0) || 1;
  const meta = (attr: (p: Player) => number, w: Record<string, number>) =>
    xi.reduce((s, p) => s + attr(p) * (w[p.position] ?? 0), 0) / wsum(w);
  return {
    attack: meta(attackAttr, ATT_W),
    midfield: meta(midAttr, MID_W),
    defense: meta(defAttr, DEF_W),
  };
}

// ---- per-position summary --------------------------------------------------
function positionSummary(roster: Player[]) {
  return POSITIONS.map((pos) => {
    const ps = roster.filter((p) => p.position === pos);
    const best = ps.length ? Math.max(...ps.map(playerOverall)) : 0;
    const avg = ps.length ? ps.reduce((s, p) => s + playerOverall(p), 0) / ps.length : 0;
    return { count: ps.length, best, avg };
  });
}

export type LastSeason = { position: number; size: number; points: number; outcome: number } | null;

// ---- observation -----------------------------------------------------------
export function buildObs(e: CareerEngine, phase: Phase, last: LastSeason): number[] {
  const squad: Team = e.squad();
  const roster = squad.roster;
  const xiPlayers = bestEleven(roster).starting_xi
    .map((id) => roster.find((p) => p.id === id))
    .filter((p): p is Player => !!p);
  const str = squadStrength(xiPlayers);

  const totalSalary = roster.reduce((s, p) => {
    const a = p.attributes;
    const avgAttr = (a.pace + a.technique + a.passing + a.defending + a.finishing + a.stamina) / 6;
    return s + avgAttr * 500;
  }, 0);

  const obs: number[] = [
    phase === "transfer" ? 1 : 0,
    phase === "tactics" ? 1 : 0,
    e.tier() === 2 ? 1 : 0,
    (e.career.currentSeason.year - 2026) / 10,
    e.money() / 1_000_000,
    totalSalary / 1_000_000,
    str.attack / 100,
    str.midfield / 100,
    str.defense / 100,
    roster.length / 25,
  ];

  for (const ps of positionSummary(roster)) {
    obs.push(ps.count / 10, ps.best / 100, ps.avg / 100);
  }

  if (last) {
    obs.push(last.position / Math.max(1, last.size), last.points / 60, last.outcome);
  } else {
    obs.push(0, 0, 0);
  }

  // 12 free agents (stable order from generateFreeAgents)
  const agents = e.freeAgents();
  const money = e.money();
  for (let i = 0; i < N_AGENTS; i++) {
    const a = agents[i];
    if (!a) {
      obs.push(0, 0, 0, 0, 0, 0, 0);
      continue;
    }
    const price = buyPrice(a);
    obs.push(
      playerOverall(a) / 100,
      a.position === "GK" ? 1 : 0,
      a.position === "DEF" ? 1 : 0,
      a.position === "MID" ? 1 : 0,
      a.position === "FWD" ? 1 : 0,
      price / 1_000_000,
      price <= money ? 1 : 0,
    );
  }
  return obs;
}

export const OBS_DIM = 2 + 1 + 1 + 2 + 3 + 1 + POSITIONS.length * 3 + 3 + N_AGENTS * 7; // 109

// ---- action mask -----------------------------------------------------------
/** Stable roster ordering for sell-slot indexing: by id ascending. */
export function sellRoster(e: CareerEngine): Player[] {
  const r = e.squad().roster;
  return r.slice().sort((a, b) => a.id - b.id);
}

export function buildMask(e: CareerEngine, phase: Phase): boolean[] {
  const mask = new Array(ACTION_DIM).fill(false);
  if (phase === "tactics") {
    for (let i = A_TACTICS_BASE; i < A_TACTICS_BASE + N_TACTICS; i++) mask[i] = true;
    return mask;
  }
  // transfer phase
  const owned = new Set(e.squad().roster.map((p) => p.id));
  const agents = e.freeAgents();
  for (let i = 0; i < N_AGENTS; i++) {
    const a = agents[i];
    // Can't re-buy an agent already on the roster (the real market removes
    // bought agents from the pool; we regenerate the full pool each step).
    if (a && !owned.has(a.id) && e.buyAllowed(buyPrice(a))) mask[A_BUY_BASE + i] = true;
  }
  const roster = sellRoster(e);
  for (let j = 0; j < MAX_ROSTER_SLOTS; j++) {
    const p = roster[j];
    if (p && e.sellAllowed(p.id)) mask[A_SELL_BASE + j] = true;
  }
  mask[A_END_TRANSFERS] = true; // ending the market is always allowed
  return mask;
}

// playerPrice("buy") without importing the symbol twice — re-derive via overall
// is wrong; use the engine's own pricing through the agent list instead.
import { playerPrice } from "/Users/felipe/Projects/gandula/web/src/util/transfer-market";
function buyPrice(p: Player): number {
  return playerPrice(p, "buy");
}
