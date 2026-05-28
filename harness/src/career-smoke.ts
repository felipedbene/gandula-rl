// Milestone 2 smoke: drive the headless career loop with the REAL game logic.
//
//   1. New career → play season 1 on default tactics; print finances + finish.
//   2. Same seed, very-attacking tactics → show the result actually changes
//      (proves resimulateFromRound is wired through).
//   3. Determinism: two identical runs produce identical standings.
//   4. A multi-season run with per-season tactics + a couple of greedy buys.

import { CareerEngine } from "./career";
import type { TeamStats } from "./career";

const SEED = Number(process.argv[2] ?? 1998);

function sig(standings: TeamStats[]): string {
  return standings
    .map((s) => `${s.team_id}:${s.won}-${s.drawn}-${s.lost}/${s.goals_for}-${s.goals_against}`)
    .join("|");
}

function playSeasonToEnd(e: CareerEngine): void {
  while (!e.seasonFinished()) {
    if (!e.advanceRound()) break;
    if (e.status === "fired") return;
  }
}

function teamName(e: CareerEngine): string {
  return e.squad().name;
}

// --- 1. default-tactics season ---------------------------------------------
{
  const e = new CareerEngine();
  e.reset(SEED);
  console.log(`\n=== Career seed ${SEED} — controlling "${teamName(e)}" (tier ${e.tier()}) ===`);
  console.log(`start money: ${e.money().toLocaleString()}`);
  playSeasonToEnd(e);
  const pos = e.userPosition();
  console.log(
    `[default tactics] season ${e.career.currentSeason.year}: ` +
      `pos ${pos}/${e.finalStandings().length}, pts ${e.userPoints()}, money ${e.money().toLocaleString()}`,
  );
}

// --- 2. very-attacking tactics, same seed -----------------------------------
let attackingSig = "";
{
  const e = new CareerEngine();
  e.reset(SEED);
  e.setTactics(
    e.buildTactics({
      formation: "F433",
      mentality: "VeryAttacking",
      tempo: "Fast",
      pressing: "High",
      width: "Wide",
    }),
  );
  playSeasonToEnd(e);
  attackingSig = sig(e.finalStandings());
  console.log(
    `[very attacking ] season ${e.career.currentSeason.year}: ` +
      `pos ${e.userPosition()}/${e.finalStandings().length}, pts ${e.userPoints()}, money ${e.money().toLocaleString()}`,
  );
}

// --- 3. determinism ---------------------------------------------------------
{
  const e = new CareerEngine();
  e.reset(SEED);
  e.setTactics(
    e.buildTactics({
      formation: "F433",
      mentality: "VeryAttacking",
      tempo: "Fast",
      pressing: "High",
      width: "Wide",
    }),
  );
  playSeasonToEnd(e);
  const ok = sig(e.finalStandings()) === attackingSig;
  console.log(`[determinism    ] identical standings on re-run: ${ok ? "YES ✓" : "NO ✗"}`);
}

// --- 4. multi-season career -------------------------------------------------
{
  const e = new CareerEngine();
  e.reset(SEED);
  console.log(`\n=== Multi-season run (greedy-ish), "${teamName(e)}" ===`);
  for (let yr = 0; yr < 8 && e.status === "running"; yr++) {
    // Tactics: lean attacking in B, balanced in A.
    e.setTactics(
      e.buildTactics({
        formation: e.tier() === 2 ? "F433" : "F4231",
        mentality: e.tier() === 2 ? "Attacking" : "Balanced",
        tempo: "Normal",
        pressing: "Medium",
        width: "Normal",
      }),
    );
    // One greedy buy if affordable: best free agent by overall.
    const agents = e.freeAgents().slice().sort((a, b) => avg(b) - avg(a));
    for (const a of agents) {
      // price via engine guard
      if (e.buyAllowed(priceGuess(a))) {
        try {
          e.buy(a);
          break;
        } catch {
          /* roster/budget edge — skip */
        }
      }
    }
    const year = e.career.currentSeason.year;
    playSeasonToEnd(e);
    if (e.status === "fired") {
      console.log(`  ${year}: FIRED — balance ${e.money().toLocaleString()}`);
      break;
    }
    // Capture finish BEFORE advancing (advanceSeason replaces the season).
    const finalStandings = e.finalStandings();
    const pos = e.userPosition(finalStandings);
    const pts = e.userPoints(finalStandings);
    const tierName = e.tier() === 1 ? "A" : "B";
    const champ = pos === 1;
    e.advanceSeason();
    console.log(
      `  ${year} Série ${tierName}: pos ${pos}, pts ${pts}, ` +
        `money ${e.money().toLocaleString()}` +
        (champ ? "  🏆 CHAMPION" : ""),
    );
    if (champ && tierName === "A") {
      console.log("  >>> Won Série A — career objective reached.");
      break;
    }
  }
}

// helpers
function avg(p: { attributes: Record<string, number> }): number {
  const a = p.attributes;
  return (a.pace + a.technique + a.passing + a.defending + a.finishing + a.stamina) / 6;
}
// A loose price estimate just to gate the buy attempt; the engine re-checks.
function priceGuess(p: { attributes: Record<string, number>; age: number }): number {
  const a = avg(p);
  return Math.round(a * a * 100);
}
