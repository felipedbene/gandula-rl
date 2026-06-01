// Headless Gandula career engine.
//
// Reconstructs the career loop that the React app orchestrates (SeasonView /
// TransferMarketView), but reusing the game's REAL pure functions from
// gandula/web/src/util/*. No browser, no IndexedDB — a Career object lives in
// memory and we drive it turn by turn. This is the substrate the RL env steps.
//
// Parity guarantee: every state transition delegates to the same function the
// web app calls (resimulateFromRound, advanceCareer, roundCashDelta, etc.), so
// for a fixed (seed, starter, tactics, transfers) the season standings are
// identical to what the website would produce.

import { run_season } from "../wasm-node/gandula_wasm.js";
import { ALL_TEAMS, teamById } from "./teams-node";

import {
  FIRST_YEAR,
  STARTING_MONEY,
  findUserDivisionIdxInSeason,
  totalRoundsOf,
  type Career,
  type Division,
  type Season,
  type UserTactics,
} from "/home/felipe/Projects/gandula/web/src/persistence";
import type { Team, Player, SeasonRecord, TeamStats } from "/home/felipe/Projects/gandula/web/src/types";
import { computeStandings, points } from "/home/felipe/Projects/gandula/web/src/types";
import { divideIntoDivisions, pickStarterTeam } from "/home/felipe/Projects/gandula/web/src/util/divisions";
import { resimulateFromRound } from "/home/felipe/Projects/gandula/web/src/util/resimulate";
import {
  roundCashDelta,
  computeSeasonFinances,
  cupPrizeForAdvance,
  isManagerFired,
  seedStadiumForTier,
} from "/home/felipe/Projects/gandula/web/src/util/finances";
import {
  COPA_ROUND_AT_LEAGUE_ROUND,
  cupSeedFor,
  cupTeamResolver,
  freshCopa,
  playCupRound,
} from "/home/felipe/Projects/gandula/web/src/util/copa";
import { computePromotionRelegation, userOutcomeFromPRResult } from "/home/felipe/Projects/gandula/web/src/util/promotion";
import { advanceCareer } from "/home/felipe/Projects/gandula/web/src/util/career";
import { userTeam } from "/home/felipe/Projects/gandula/web/src/util/roster";
import {
  generateFreeAgents,
  playerPrice,
  canBuy,
  canSell,
  MIN_ROSTER,
  MAX_ROSTER,
} from "/home/felipe/Projects/gandula/web/src/util/transfer-market";

export type CareerStatus = "running" | "fired" | "ended";

/** A thin, mutable wrapper that drives a single Career through its lifecycle. */
export class CareerEngine {
  career!: Career;
  status: CareerStatus = "running";

  /** Create a fresh career. `seed` is the career seed; `starterId` lets the
   *  caller fix which Série C club to manage (defaults to the deterministic
   *  weakest team, matching pickStarterTeam). Mirrors SeasonView.run() for the
   *  v9 / 3-tier / full-economy game. */
  reset(seed: number | bigint, starterId?: number | "random"): void {
    const [tierA, tierB, tierC] = divideIntoDivisions(ALL_TEAMS);
    let starter: Team;
    if (starterId === "random") {
      // Website-faithful: any Série C club, but seeded so episodes reproduce.
      const idx = Number(((BigInt(seed) % BigInt(tierC.length)) + BigInt(tierC.length)) % BigInt(tierC.length));
      starter = tierC[idx];
    } else if (starterId !== undefined) {
      starter = mustTeam(starterId);
    } else {
      starter = pickStarterTeam(tierC); // deterministic weakest — the hard case
    }

    const careerSeed = BigInt(seed);
    const seasonSeed = careerSeed ^ BigInt(FIRST_YEAR);

    const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
    const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
    const recordC = run_season(tierC, seasonSeed ^ 3n, "Série C") as SeasonRecord;

    const currentSeason: Season = {
      year: FIRST_YEAR,
      seed: seasonSeed,
      divisions: [
        { tier: 1, name: "Série A", record: recordA, currentRoundIdx: 0 },
        { tier: 2, name: "Série B", record: recordB, currentRoundIdx: 0 },
        { tier: 3, name: "Série C", record: recordC, currentRoundIdx: 0 },
      ],
      transfers: [],
      copa: freshCopa(),
    };

    this.career = {
      schemaVersion: 9,
      savedAt: new Date().toISOString(),
      seed: careerSeed,
      controlledTeamId: starter.id,
      seasons: [],
      currentSeason,
      manager: { money: STARTING_MONEY, ...seedStadiumForTier(3) },
      userRoster: [],
    };
    this.status = "running";
  }

  // ----- views ---------------------------------------------------------------

  userDivIdx(): number {
    return findUserDivisionIdxInSeason(this.career.currentSeason, this.career.controlledTeamId);
  }
  userDivision(): Division {
    return this.career.currentSeason.divisions[this.userDivIdx()];
  }
  currentRoundIdx(): number {
    return this.userDivision().currentRoundIdx;
  }
  totalRounds(): number {
    return totalRoundsOf(this.userDivision());
  }
  seasonFinished(): boolean {
    return this.currentRoundIdx() >= this.totalRounds();
  }
  money(): number {
    return this.career.manager.money;
  }
  tier(): 1 | 2 | 3 {
    return this.userDivision().tier;
  }
  /** The user's current squad (registry default until a transfer happens). */
  squad(): Team {
    return userTeam(this.career);
  }

  /** Live standings up to the current round (provisional during a season). */
  liveStandings(): TeamStats[] {
    const div = this.userDivision();
    const teamIds = div.record.standings.map((s) => s.team_id);
    return computeStandings(
      div.record.matches,
      div.record.fixtures,
      this.currentRoundIdx(),
      teamIds,
    );
  }
  /** Final (full-season) standings as simulated. */
  finalStandings(): TeamStats[] {
    return this.userDivision().record.standings;
  }
  userPosition(standings: TeamStats[] = this.finalStandings()): number {
    return standings.findIndex((s) => s.team_id === this.career.controlledTeamId) + 1;
  }
  userPoints(standings: TeamStats[] = this.finalStandings()): number {
    const s = standings.find((x) => x.team_id === this.career.controlledTeamId);
    return s ? points(s) : 0;
  }

  // ----- tactics -------------------------------------------------------------

  /** Build a complete UserTactics from the five knobs, reusing the squad's
   *  current XI/bench. (XI optimization is a later extension.) */
  buildTactics(knobs: {
    formation: UserTactics["formation"];
    mentality: UserTactics["tactics"]["mentality"];
    tempo: UserTactics["tactics"]["tempo"];
    pressing: UserTactics["tactics"]["pressing"];
    width: UserTactics["tactics"]["width"];
  }): UserTactics {
    const t = this.squad();
    return {
      formation: knobs.formation,
      tactics: {
        mentality: knobs.mentality,
        tempo: knobs.tempo,
        pressing: knobs.pressing,
        width: knobs.width,
      },
      starting_xi: t.starting_xi.slice(),
      bench: (t.bench ?? []).slice(),
    };
  }

  /** Apply tactics and re-simulate the user's remaining fixtures from the
   *  current round. Mirrors TacticsView/PrepareView → resimulateFromRound. */
  setTactics(tactics: UserTactics): void {
    this.career = resimulateFromRound(this.career, this.currentRoundIdx(), tactics);
  }

  // ----- transfers -----------------------------------------------------------

  /** The deterministic 12-player free-agent pool for the current season. */
  freeAgents(): Player[] {
    return generateFreeAgents(this.career.seed, this.career.currentSeason.year);
  }
  buyAllowed(price: number): boolean {
    return canBuy(this.career, price).ok;
  }
  sellAllowed(playerId: number): boolean {
    return canSell(this.career, playerId).ok;
  }

  buy(player: Player): void {
    const price = playerPrice(player, "buy");
    if (!this.buyAllowed(price)) throw new Error(`buy not allowed: ${player.name}`);
    const roster = this.currentRoster();
    if (roster.some((p) => p.id === player.id)) {
      throw new Error(`buy rejected: ${player.id} already on roster`);
    }
    this.career = {
      ...this.career,
      userRoster: [...roster, player],
      manager: { ...this.career.manager, money: this.career.manager.money - price },
      currentSeason: {
        ...this.career.currentSeason,
        transfers: [
          ...this.career.currentSeason.transfers,
          { kind: "buy", playerName: player.name, position: player.position, price },
        ],
      },
    };
  }

  sell(playerId: number): void {
    if (!this.sellAllowed(playerId)) throw new Error(`sell not allowed: ${playerId}`);
    const roster = this.currentRoster();
    const player = roster.find((p) => p.id === playerId);
    if (!player) throw new Error(`sell: player ${playerId} not in roster`);
    const price = playerPrice(player, "sell");
    const newRoster = roster.filter((p) => p.id !== playerId);
    // Prune from current-season tactics bench if present (mirrors the UI).
    const ut = this.career.currentSeason.userTactics;
    const newUt =
      ut && ut.bench.includes(playerId)
        ? { ...ut, bench: ut.bench.filter((id) => id !== playerId) }
        : ut;
    this.career = {
      ...this.career,
      userRoster: newRoster,
      manager: { ...this.career.manager, money: this.career.manager.money + price },
      currentSeason: {
        ...this.career.currentSeason,
        userTactics: newUt,
        transfers: [
          ...this.career.currentSeason.transfers,
          { kind: "sell", playerName: player.name, position: player.position, price },
        ],
      },
    };
  }

  /** The user's effective roster (registry default if no transfers yet). */
  private currentRoster(): Player[] {
    return this.career.userRoster.length > 0
      ? this.career.userRoster
      : this.squad().roster.slice();
  }

  // ----- advancement ---------------------------------------------------------

  /** Advance one round: accrue finances for the round about to play, bump the
   *  round counters (silent-advancing the non-user division), then check the
   *  firing condition. Mirrors SeasonView.playRound. Returns false if the
   *  season is already finished (no-op). */
  advanceRound(): boolean {
    if (this.seasonFinished()) return false;
    const season = this.career.currentSeason;
    const playedRound = this.currentRoundIdx();
    const cashDelta = roundCashDelta(this.career, playedRound);

    const userIdx = this.userDivIdx();
    const divisions = season.divisions.map((d, i) => {
      const total = totalRoundsOf(d);
      if (i === userIdx) return { ...d, currentRoundIdx: d.currentRoundIdx + 1 };
      if (d.currentRoundIdx < total) return { ...d, currentRoundIdx: d.currentRoundIdx + 1 };
      return d;
    });
    // Silent-advance: once the user's division ends, fast-forward the others.
    const userAdvanced = divisions[userIdx];
    if (userAdvanced.currentRoundIdx >= totalRoundsOf(userAdvanced)) {
      divisions.forEach((d, i) => {
        if (i !== userIdx) divisions[i] = { ...d, currentRoundIdx: totalRoundsOf(d) };
      });
    }

    // Copa do Brasil matchday (E.3): on a mapped league round, play the cup
    // round and pay the cup prize. Mirrors SeasonView.playRound.
    let copa = season.copa;
    let cupPrize = 0;
    const cupRoundIdx = COPA_ROUND_AT_LEAGUE_ROUND.indexOf(playedRound);
    if (cupRoundIdx >= 0 && copa.currentCupRoundIdx === cupRoundIdx) {
      const nextCopa = playCupRound(
        copa,
        cupRoundIdx,
        cupTeamResolver(this.career),
        cupSeedFor(season),
        this.career.controlledTeamId,
      );
      cupPrize = cupPrizeForAdvance(copa, nextCopa, this.career.controlledTeamId);
      copa = nextCopa;
    }

    this.career = {
      ...this.career,
      currentSeason: { ...season, divisions, copa },
      manager: { ...this.career.manager, money: this.career.manager.money + cashDelta + cupPrize },
    };

    if (isManagerFired(this.career.manager.money)) {
      this.status = "fired";
    }
    return true;
  }

  /** Promotion/relegation result for the finished season (both tiers done). */
  prResult() {
    return computePromotionRelegation(this.career.currentSeason, this.career.controlledTeamId);
  }

  /** Advance to the next season. Requires the season to be finished. Applies
   *  the P/R-bonus firing check, then advanceCareer. Mirrors
   *  SeasonView.advanceToNextSeason. */
  advanceSeason(): void {
    if (!this.seasonFinished()) throw new Error("advanceSeason: season not finished");
    const pr = this.prResult();
    const userOutcome = userOutcomeFromPRResult(pr);
    const finances = computeSeasonFinances(this.career, userOutcome);
    // Boundary money = P/R bonus + placement prize (the per-round + cup pieces
    // already accrued into manager.money). Mirrors SeasonView.advanceToNextSeason.
    const boundaryDelta = finances.prBonus + finances.placementPrize;
    if (isManagerFired(this.career.manager.money + boundaryDelta)) {
      this.career = {
        ...this.career,
        manager: { ...this.career.manager, money: this.career.manager.money + boundaryDelta },
      };
      this.status = "fired";
      return;
    }
    const { history, nextSeason, agedUserRoster, nextFanbase, nextMarketingMomentum } =
      advanceCareer(this.career, pr);
    this.career = {
      ...this.career,
      savedAt: new Date().toISOString(),
      seasons: [...this.career.seasons, history],
      currentSeason: nextSeason,
      userRoster: agedUserRoster,
      manager: {
        ...this.career.manager,
        money: this.career.manager.money + boundaryDelta,
        fanbase: nextFanbase,
        marketingMomentum: nextMarketingMomentum,
      },
    };
  }
}

function mustTeam(id: number): Team {
  const t = teamById(id);
  if (!t) throw new Error(`team ${id} not in registry`);
  return t;
}

export { MIN_ROSTER, MAX_ROSTER };
export type { Career, UserTactics, Player, TeamStats };
