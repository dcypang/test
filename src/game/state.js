/**
 * Race state: the clock, the scoring, and the rules the objective banner
 * describes. Deliberately free of DOM and three.js references so the rules can
 * be reasoned about (and tested) on their own.
 */

import { clamp, MPS_TO_MPH } from '../engine/util.js';

export const PHASE = {
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  RACING: 'racing',
  PAUSED: 'paused',
  FINISHED: 'finished',
};

const CLEAN_BONUS = 5000;
const BEST_TIME_KEY = 'redline-rider:best';

export class RaceState {
  constructor() {
    this.phase = PHASE.MENU;
    this.trackId = null;
    this.reset();
    this.bestTimes = loadBestTimes();
  }

  reset() {
    this.elapsed = 0;
    this.countdown = 0;
    this.crashes = 0;
    this.topSpeed = 0;
    this.score = 0;
    this.multiplier = 1;
    this._multiplierTimer = 0;
    this.nearMisses = 0;
    this.clean = true;
    this.finishedAt = null;
    this._distanceScored = 0;
  }

  get bestTime() {
    return this.trackId ? this.bestTimes[this.trackId] ?? null : null;
  }

  /** Begin a race on `trackId` with a short countdown. */
  start(trackId) {
    this.trackId = trackId;
    this.reset();
    this.phase = PHASE.COUNTDOWN;
    this.countdown = 3.2;
  }

  pause() {
    if (this.phase === PHASE.RACING || this.phase === PHASE.COUNTDOWN) {
      this._resumePhase = this.phase;
      this.phase = PHASE.PAUSED;
      return true;
    }
    return false;
  }

  resume() {
    if (this.phase === PHASE.PAUSED) {
      this.phase = this._resumePhase || PHASE.RACING;
      return true;
    }
    return false;
  }

  get running() {
    return this.phase === PHASE.RACING;
  }

  /** Whether the simulation should step this frame. */
  get simulating() {
    return this.phase === PHASE.RACING || this.phase === PHASE.COUNTDOWN;
  }

  /**
   * Advance the clock and scoring.
   * @returns 'go' on the frame the countdown ends, otherwise null.
   */
  update(dt, player) {
    let event = null;

    if (this.phase === PHASE.COUNTDOWN) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = PHASE.RACING;
        this.countdown = 0;
        event = 'go';
      } else if (Math.ceil(this.countdown) !== before) {
        event = 'tick';
      }
      return event;
    }

    if (this.phase !== PHASE.RACING) return null;

    this.elapsed += dt;
    if (player.speed > this.topSpeed) this.topSpeed = player.speed;

    // Distance points, awarded per 10 m so the score ticks visibly.
    const chunk = Math.floor(player.progress / 10);
    if (chunk > this._distanceScored) {
      const gained = chunk - this._distanceScored;
      this._distanceScored = chunk;
      this.score += gained * 10 * this.multiplier;
    }

    // The multiplier climbs while you hold real speed and decays otherwise, so
    // it rewards commitment rather than just survival.
    const fast = player.speed * MPS_TO_MPH > 90 && !player.crashed;
    this._multiplierTimer += fast ? dt : -dt * 1.6;
    this._multiplierTimer = clamp(this._multiplierTimer, 0, 24);
    this.multiplier = 1 + Math.floor(this._multiplierTimer / 4) * 0.5;

    return null;
  }

  registerCrash() {
    this.crashes++;
    this.clean = false;
    this._multiplierTimer = 0;
    this.multiplier = 1;
    this.score = Math.max(0, this.score - 500);
  }

  registerNearMiss() {
    this.nearMisses++;
    this.score += 120 * this.multiplier;
    this._multiplierTimer = Math.min(24, this._multiplierTimer + 1.2);
  }

  /** Close the race out and produce the summary the finish panel renders. */
  finish(player) {
    if (this.phase === PHASE.FINISHED) return this.result;
    this.phase = PHASE.FINISHED;

    const bonus = this.clean ? CLEAN_BONUS : 0;
    const timeBonus = Math.max(0, Math.round((300 - this.elapsed) * 20));
    const score = Math.round(this.score + bonus + timeBonus);

    const previous = this.bestTime;
    const isBest = previous === null || this.elapsed < previous;
    if (isBest && this.trackId) {
      this.bestTimes[this.trackId] = this.elapsed;
      saveBestTimes(this.bestTimes);
    }

    this.result = {
      title: this.clean ? 'CLEAN RUN' : 'RACE COMPLETE',
      time: this.elapsed,
      distance: player.progress,
      topSpeed: this.topSpeed,
      crashes: this.crashes,
      bonus,
      timeBonus,
      score,
      isBest,
    };
    this.score = score;
    return this.result;
  }

  get objective() {
    if (this.clean) return 'FINISH THE RACE WITHOUT ANY CRASH TO RECEIVE THE BONUS';
    return `BONUS LOST — ${this.crashes} CRASH${this.crashes === 1 ? '' : 'ES'}. FINISH THE RACE`;
  }
}

/* ------------------------------------------------------------------
   Best-time persistence
   ------------------------------------------------------------------ */

function loadBestTimes() {
  try {
    const raw = localStorage.getItem(BEST_TIME_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Private browsing, disabled storage, corrupt JSON — a missing best time
    // is never worth failing the game over.
    return {};
  }
}

function saveBestTimes(times) {
  try {
    localStorage.setItem(BEST_TIME_KEY, JSON.stringify(times));
  } catch {
    /* not fatal */
  }
}
