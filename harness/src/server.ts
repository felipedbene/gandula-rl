// stdio JSON-lines server: drives a CareerEngine as a turn-based MDP for the
// Python Gymnasium env. One JSON object per line in, one per line out.
//
// Protocol:
//   in  {"cmd":"reset","seed":N,"starter":id?,"max_seasons":K?}
//   out {"obs":[...],"mask":[bool...],"info":{...}}
//   in  {"cmd":"step","action":i}
//   out {"obs":[...],"mask":[bool...],"reward":r,"done":bool,"info":{...}}
//   in  {"cmd":"close"}  → process exits
//
// Episode = one career. Two phases alternate per season:
//   transfer (buy/sell/end) → tactics (one of 540 combos) → env auto-plays the
//   whole season, accrues finances, checks firing, advances the season.
// Terminal: fired, or won Série A (objective), or max_seasons reached.

import readline from "node:readline";
import { CareerEngine } from "./career";
import {
  A_BUY_BASE,
  A_SELL_BASE,
  A_END_TRANSFERS,
  N_AGENTS,
  N_TACTICS,
  MAX_ROSTER_SLOTS,
  ACTION_DIM,
  OBS_DIM,
  bestEleven,
  buildMask,
  buildObs,
  decodeTactics,
  sellRoster,
  type LastSeason,
  type Phase,
} from "./encode";
import { userOutcomeFromPRResult } from "/Users/felipe/Projects/gandula/web/src/util/promotion";
import { playerOverall, playerPrice } from "/Users/felipe/Projects/gandula/web/src/util/transfer-market";
import { points } from "/Users/felipe/Projects/gandula/web/src/types";
import { teamById } from "./teams-node";
import type { UserTactics } from "/Users/felipe/Projects/gandula/web/src/persistence";

type TransferRec = { kind: "buy" | "sell"; playerId: number; name: string; position: string; price: number };
type SeasonRec = {
  year: number;
  tier: number;
  transfers: TransferRec[];
  tactics: UserTactics | null;
  result: Record<string, unknown> | null;
};

// ---- reward shaping (tunable; mirror in docs) ------------------------------
const R_FIRED = -5.0;
const R_PROMO = 3.0;
const R_RELEG = -2.0;
const R_WIN_A = 10.0;
const W_PTS = 0.02; // per league point
const W_MONEY = 0.2; // per 1,000,000 net cash over a season

class Session {
  e = new CareerEngine();
  phase: Phase = "transfer";
  last: LastSeason = null;
  maxSeasons = 8;
  done = false;

  // recording (for terminal replay + website watch-mode playbook export)
  replay = false;
  seed = 0;
  starterId = 0;
  seasonsRec: SeasonRec[] = [];

  reset(seed: number, starter: number | "random" | undefined, maxSeasons: number, replay = false) {
    this.e.reset(seed, starter);
    this.phase = "transfer";
    this.last = null;
    this.maxSeasons = maxSeasons;
    this.done = false;
    this.replay = replay;
    this.seed = seed;
    this.starterId = this.e.career.controlledTeamId;
    this.seasonsRec = [this.newSeasonRec()];
    return this.observe(replay ? { starter: this.starterName(), tier: this.e.tier() } : {});
  }

  private newSeasonRec(): SeasonRec {
    return { year: this.e.career.currentSeason.year, tier: this.e.tier(), transfers: [], tactics: null, result: null };
  }
  private curRec(): SeasonRec {
    return this.seasonsRec[this.seasonsRec.length - 1];
  }
  private teamName(id: number): string {
    return teamById(id)?.name ?? `Time ${id}`;
  }
  private starterName(): string {
    return this.teamName(this.starterId);
  }
  /** Top-3 plus the user's row, for replay readouts. */
  private standingsSnapshot() {
    const st = this.e.finalStandings();
    const uid = this.e.career.controlledTeamId;
    const row = (s: (typeof st)[number], i: number) => ({
      pos: i + 1,
      team: this.teamName(s.team_id),
      pts: points(s),
      gd: s.goals_for - s.goals_against,
      user: s.team_id === uid,
    });
    const top = st.slice(0, 3).map(row);
    const ui = st.findIndex((s) => s.team_id === uid);
    if (ui >= 3) top.push(row(st[ui], ui));
    return top;
  }

  /** Export the recorded decisions so the web app can replay this career. */
  dumpPlaybook() {
    return {
      playbook: {
        seed: this.seed,
        starterId: this.starterId,
        starterName: this.starterName(),
        maxSeasons: this.maxSeasons,
        seasons: this.seasonsRec,
      },
    };
  }

  private observe(info: Record<string, unknown>) {
    return {
      obs: buildObs(this.e, this.phase, this.last),
      mask: buildMask(this.e, this.phase),
      info,
    };
  }

  step(action: number) {
    if (this.done) {
      return { ...this.observe({ note: "episode-done" }), reward: 0, done: true };
    }

    if (this.phase === "transfer") {
      return this.stepTransfer(action);
    }
    return this.stepTactics(action);
  }

  private stepTransfer(action: number) {
    const info: Record<string, unknown> = {};
    if (action >= A_BUY_BASE && action < A_BUY_BASE + N_AGENTS) {
      const agent = this.e.freeAgents()[action - A_BUY_BASE];
      if (agent) {
        const price = playerPrice(agent, "buy");
        try {
          this.e.buy(agent);
          this.curRec().transfers.push({
            kind: "buy", playerId: agent.id, name: agent.name, position: agent.position, price,
          });
          if (this.replay) info.event = { kind: "buy", name: agent.name, position: agent.position, overall: playerOverall(agent), price, money: this.e.money() };
        } catch {
          /* masked-out edge; ignore */
        }
      }
    } else if (action >= A_SELL_BASE && action < A_SELL_BASE + MAX_ROSTER_SLOTS) {
      const p = sellRoster(this.e)[action - A_SELL_BASE];
      if (p) {
        const price = playerPrice(p, "sell");
        try {
          this.e.sell(p.id);
          this.curRec().transfers.push({
            kind: "sell", playerId: p.id, name: p.name, position: p.position, price,
          });
          if (this.replay) info.event = { kind: "sell", name: p.name, position: p.position, price, money: this.e.money() };
        } catch {
          /* ignore */
        }
      }
    } else {
      // A_END_TRANSFERS (or anything unexpected): close the market.
      this.phase = "tactics";
      if (this.replay) info.event = { kind: "end_market" };
    }
    info.phase = this.phase;
    return { ...this.observe(info), reward: 0, done: false };
  }

  private stepTactics(action: number) {
    // Build tactics from the chosen knobs + a best-XI from the current roster.
    // Clamp into the tactics range so an unmasked action (e.g. from env
    // checkers firing random actions) can't decode out of range.
    const knobs = decodeTactics(((action % N_TACTICS) + N_TACTICS) % N_TACTICS);
    const roster = this.e.squad().roster;
    const xi = bestEleven(roster);
    const ut: UserTactics = {
      formation: knobs.formation,
      tactics: { mentality: knobs.mentality, tempo: knobs.tempo, pressing: knobs.pressing, width: knobs.width },
      starting_xi: xi.starting_xi,
      bench: xi.bench,
    };
    this.curRec().tactics = ut;
    try {
      this.e.setTactics(ut);
    } catch (err) {
      throw new Error(
        `${String(err)} | rosterLen=${roster.length} ` +
          `xi=${xi.starting_xi.join(",")} bench=${xi.bench.join(",")} ` +
          `rosterIds=${roster.map((p) => `${p.id}:${p.position}`).join(",")}`,
      );
    }

    const moneyBefore = this.e.money();
    while (!this.e.seasonFinished()) {
      this.e.advanceRound();
      if (this.e.status === "fired") break;
    }

    let reward = 0;
    const info: Record<string, unknown> = {};

    if (this.e.status === "fired") {
      reward += R_FIRED;
      this.done = true;
      info.outcome = "fired";
      info.money = this.e.money();
      this.curRec().result = { outcome: "fired", money: this.e.money() };
      return { ...this.observe(info), reward, done: true };
    }

    // Season finished cleanly.
    const finalStandings = this.e.finalStandings();
    const pos = this.e.userPosition(finalStandings);
    const pts = this.e.userPoints(finalStandings);
    const tier = this.e.tier();
    const seasonCash = this.e.money() - moneyBefore;
    const pr = this.e.prResult();
    const outcome = userOutcomeFromPRResult(pr);

    reward += W_PTS * pts + W_MONEY * (seasonCash / 1_000_000);
    if (outcome === "promoted") reward += R_PROMO;
    else if (outcome === "relegated") reward += R_RELEG;

    const championA = tier === 1 && pos === 1;
    info.year = this.e.career.currentSeason.year;
    info.tier = tier;
    info.position = pos;
    info.points = pts;
    info.outcome = outcome;
    info.money = this.e.money();

    this.curRec().result = { tier, position: pos, points: pts, outcome, money: this.e.money() };
    if (this.replay) {
      info.tactics = `${ut.formation}/${ut.tactics.mentality}/${ut.tactics.tempo}/${ut.tactics.pressing}/${ut.tactics.width}`;
      info.standings = this.standingsSnapshot();
    }

    if (championA) {
      reward += R_WIN_A;
      this.done = true;
      info.outcome = "champion_A";
      return { ...this.observe(info), reward, done: true };
    }

    // record last-season summary for next obs
    this.last = {
      position: pos,
      size: finalStandings.length,
      points: pts,
      outcome: outcome === "promoted" ? 1 : outcome === "relegated" ? -1 : 0,
    };

    this.e.advanceSeason();
    if (this.e.status === "fired") {
      reward += R_FIRED;
      this.done = true;
      info.outcome = "fired_boundary";
      info.money = this.e.money();
      return { ...this.observe(info), reward, done: true };
    }

    const seasonsPlayed = this.e.career.currentSeason.year - 2026;
    if (seasonsPlayed >= this.maxSeasons) {
      this.done = true;
      info.truncated = true;
      return { ...this.observe(info), reward, done: true };
    }

    // New season begins — start recording it.
    this.seasonsRec.push(this.newSeasonRec());
    this.phase = "transfer";
    return { ...this.observe(info), reward, done: false };
  }
}

// ---- stdio loop ------------------------------------------------------------
const session = new Session();
const rl = readline.createInterface({ input: process.stdin });

function send(obj: unknown) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    send({ error: `bad json: ${String(err)}` });
    return;
  }
  try {
    switch (msg.cmd) {
      case "reset":
        send(session.reset(Number(msg.seed ?? 0), msg.starter, Number(msg.max_seasons ?? 8), !!msg.replay));
        break;
      case "step":
        send(session.step(Number(msg.action)));
        break;
      case "dump":
        send(session.dumpPlaybook());
        break;
      case "spec":
        send({ obs_dim: OBS_DIM, action_dim: ACTION_DIM });
        break;
      case "close":
        rl.close();
        process.exit(0);
        break;
      default:
        send({ error: `unknown cmd: ${msg.cmd}` });
    }
  } catch (err) {
    send({ error: String(err), stack: (err as Error)?.stack });
  }
});
