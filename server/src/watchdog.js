/** Motion watchdog ("HackShield"): evidence accumulation for client motion that the
 *  authoritative kernel cannot explain.
 *
 *  The authority treats the client's own trajectory as the source of truth, so a report
 *  outside the plausibility envelope is not by itself proof of anything: a dropped
 *  packet, a stalled tab or an unobserved event can produce one. A player who is
 *  *frequently* outside the envelope, or outside it by an impossible margin, is a
 *  different signal, and that is what this module accumulates.
 *
 *  Verdicts:
 *  - `accept` with `suspicious: false` — inside the envelope for the elapsed gap.
 *  - `accept` with `suspicious: true` — outside, but consistent with a one-off stall;
 *    the report is still adopted (refusing it would rubber-band an honest player) and
 *    the deviation is recorded as evidence.
 *  - `fault` — either a single absurd deviation, or more deviations inside one window
 *    than a network hiccup explains. The caller closes the session.
 *
 *  Evidence is measured in field ticks, never wall clock, so a verdict is reproducible
 *  from the same tick sequence in a test. The recorded ticks are a bounded ring. */

/** One evidence window. 900 ticks is 27 s at the 30 ms kernel quantum: long enough that
 *  a brief stall cannot accumulate, short enough that a script abusing the envelope
 *  cannot hide inside it. */
const WINDOW_TICKS = 900;
/** Deviations inside one window before the pattern stops looking like connectivity. */
const SUSPICION_LIMIT = 6;
/** A single report this far outside the gap-scaled envelope is not a stall: the envelope
 *  already grows with elapsed time, so only impossible motion reaches this. */
const ABSURD_FACTOR = 4;
/** Bounded evidence: at most this many deviation ticks are retained per actor. */
const MAX_MARKS = 32;
/** Bounded memory: at most this many actors are tracked at once. */
const MAX_TRACKED = 256;

/** @typedef {{position:number, velocity:number, allowedPosition:number, allowedVelocity:number}} MotionExcess */

function createEvidence(tick) {
  return {
    window: tick,
    marks: [],
    peakPosition: 0,
    peakVelocity: 0,
    faults: 0,
  };
}

export class MotionWatchdog {
  constructor({ log = null } = {}) {
    this.log = log;
    this.actors = new Map();
    this.reviewed = 0;
    this.suspicious = 0;
    this.faults = 0;
  }

  /** Judge one report and record it. Never mutates the caller's simulation. */
  review(id, tick, excess) {
    this.reviewed++;
    const absurd =
      excess.position > excess.allowedPosition * ABSURD_FACTOR ||
      excess.velocity > excess.allowedVelocity * ABSURD_FACTOR;
    const outside =
      excess.position > excess.allowedPosition ||
      excess.velocity > excess.allowedVelocity;
    if (!outside) return { decision: "accept", suspicious: false, score: 0 };
    this.suspicious++;
    const evidence = this.track(id, tick);
    evidence.marks.push(tick);
    if (evidence.marks.length > MAX_MARKS) evidence.marks.shift();
    evidence.peakPosition = Math.max(evidence.peakPosition, excess.position);
    evidence.peakVelocity = Math.max(evidence.peakVelocity, excess.velocity);
    this.prune(evidence, tick);
    if (!absurd && evidence.marks.length < SUSPICION_LIMIT) {
      return {
        decision: "accept",
        suspicious: true,
        score: evidence.marks.length,
      };
    }
    evidence.faults++;
    this.faults++;
    this.log?.("watchdog.fault", {
      character: id,
      tick,
      absurd,
      deviations: evidence.marks.length,
      position: Math.trunc(excess.position),
      velocity: Math.trunc(excess.velocity),
      allowedPosition: Math.trunc(excess.allowedPosition),
    });
    return {
      decision: "fault",
      suspicious: true,
      score: evidence.marks.length,
    };
  }

  /** Drop the oldest evidence once it is older than one window. */
  prune(evidence, tick) {
    const threshold = tick - WINDOW_TICKS;
    for (let index = 0; index < evidence.marks.length; index++) {
      if (evidence.marks[index] > threshold) {
        if (index > 0) evidence.marks.splice(0, index);
        return;
      }
    }
    evidence.marks.length = 0;
  }

  track(id, tick) {
    let evidence = this.actors.get(id);
    if (evidence) return evidence;
    if (this.actors.size >= MAX_TRACKED) {
      // Retire the least recently active actor rather than growing without bound.
      let oldestId = null;
      let oldest = Infinity;
      for (const [key, value] of this.actors) {
        const last = value.marks[value.marks.length - 1] ?? value.window;
        if (last < oldest) {
          oldest = last;
          oldestId = key;
        }
      }
      if (oldestId !== null) this.actors.delete(oldestId);
    }
    evidence = createEvidence(tick);
    this.actors.set(id, evidence);
    return evidence;
  }

  /** Release an actor's evidence when it leaves the world. */
  forget(id) {
    this.actors.delete(id);
  }

  /** Allocate only on explicit inspection. */
  snapshot() {
    const actors = [];
    for (const [id, evidence] of this.actors) {
      actors.push({
        id,
        deviations: evidence.marks.length,
        peakPosition: evidence.peakPosition,
        peakVelocity: evidence.peakVelocity,
        faults: evidence.faults,
      });
    }
    return {
      reviewed: this.reviewed,
      suspicious: this.suspicious,
      faults: this.faults,
      actors,
    };
  }
}
