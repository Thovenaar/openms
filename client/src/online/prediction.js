import { PROTOCOL } from "../../../shared/protocol.js";
import {
  restoreMotion,
  stepMotion,
  createHeldInput,
  assignHeldInput,
} from "../../../shared/motion.js";
import { applyExternalImpulse } from "../physics/simulation.js";

const STALE_OBSERVATION_MS = 1000;
/** Small server/client disagreement is absorbed by the presentation instead of corrected:
 *  the kernel still adopts the authoritative state, the drawn pose glides to it. */
const POSITION_TOLERANCE_PX = 24;
const CORRECTION_MS = 120;
/** An authoritative divert explains its own presented offset, so it is not evidence of
 *  a desync. It may therefore exceed POSITION_TOLERANCE_PX up to this bound — the
 *  INPUT_LEAD_TICKS + INPUT_BUFFER_TICKS suffix of the strongest movement impulse
 *  (350 px/s x 150 ms = 52.5 px) fits with headroom. */
const DIVERT_CORRECTION_MAX_PX = 96;
/** Removal rate for an explained offset. 0.125 px/ms is exactly walkSpeed, so the
 *  extra drawn travel inside one 30 ms kernel quantum stays at or below 3.75 px and
 *  the player reads a continuous trajectory rather than a rubber-band. */
const DIVERT_CORRECTION_PX_PER_MS = 0.125;
/** A replayed divert tick must reproduce the authoritative checkpoint of that tick.
 *  The same deterministic kernel on the same base and the same recorded input is
 *  exact, so only a genuinely server-owned difference (movement lock, seat, retired
 *  input hint) exceeds this and falls back to plain authoritative adoption. */
const DIVERT_REPLAY_POSITION_PX = 0.5;
const DIVERT_REPLAY_VELOCITY = 1;
/** Bound on authoritative impulses described by one motion checkpoint. */
const MAX_DIVERTS = 2;

/** One checkpoint's divert list is placeable only when it describes this very tick,
 *  within the bound, for a tick that has a retained predecessor. */
function validDivertRecords(diverts, tick) {
  if (!Array.isArray(diverts) || diverts.length === 0) return false;
  if (diverts.length > MAX_DIVERTS) return false;
  for (const divert of diverts) {
    if (divert.tick !== tick) return false;
    if (!Number.isFinite(divert.vx) || !Number.isFinite(divert.vy)) {
      return false;
    }
  }
  return tick >= 2;
}

/** The replayed divert tick must reproduce the authoritative checkpoint of that tick. */
function divertReproduced(probe, motion) {
  if (!probe.captured) return false;
  const position = Math.hypot(probe.x - motion.x, probe.y - motion.y);
  const velocity = Math.hypot(probe.vx - motion.vx, probe.vy - motion.vy);
  if (!Number.isFinite(position) || !Number.isFinite(velocity)) return false;
  return (
    position <= DIVERT_REPLAY_POSITION_PX && velocity <= DIVERT_REPLAY_VELOCITY
  );
}

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function historyEntry() {
  return {
    inputSeq: 0,
    targetTick: 0,
    horizontal: 0,
    vertical: 0,
    jump: false,
    attack: false,
    action: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };
}

/** Disposable movement presentation. Call advance from a fixed scheduler, never from RAF. */
export class OnlinePrediction {
  constructor({ onInput, onResync, onGroundJump } = {}) {
    this.onInput = onInput;
    this.onResync = onResync;
    this.onGroundJump = onGroundJump;
    this.groundJumpSequence = null;
    this.simulation = null;
    this.held = createHeldInput();
    this.history = Array.from({ length: PROTOCOL.INPUT_HISTORY }, historyEntry);
    this.sample = {
      targetTick: 0,
      horizontal: 0,
      vertical: 0,
      jump: false,
      attack: false,
      motion: { x: 0, y: 0, vx: 0, vy: 0 },
    };
    this.head = 0;
    this.count = 0;
    this.ready = false;
    this.paused = false;
    this.serverTick = 0;
    this.predictedTick = 0;
    this.lastObservedAt = 0;
    this.connectionEpoch = null;
    this.fieldEpoch = null;
    this.ackInputSeq = 0;
    this.corrections = 0;
    this.maximumPositionError = 0;
    this.lastPositionError = 0;
    this.lastVelocityError = 0;
    this.replayedTicks = 0;
    this.overflows = 0;
    this.catchUpDebt = 0;
    this.timingState = null;
    this.filledTicks = 0;
    this.arrivalTick = 0;
    this.lastStepAt = 0;
    this.queuedAction = null;
    this.correctionX = 0;
    this.correctionY = 0;
    this.correctionUntil = 0;
    this.correctionSpan = CORRECTION_MS;
    this.diverts = 0;
  }

  /** Simulation must be built only from the authoritative field's immutable physics. */
  install(sim, serverTick) {
    if (!sim || !Number.isSafeInteger(serverTick) || serverTick < 0) {
      throw new Error("Invalid prediction installation");
    }
    this.clear();
    this.simulation = sim;
    this.serverTick = serverTick;
    this.predictedTick = serverTick;
  }

  /** Adopt the transport's filtered authenticated clock; simulation installation preserves timing. */
  timing(value) {
    this.timingState = value;
    if (
      this.connectionEpoch &&
      (this.connectionEpoch !== value.connectionEpoch ||
        this.fieldEpoch !== value.fieldEpoch)
    ) {
      this.ready = false;
    }
  }

  /** Import the complete kernel checkpoint before replaying the bounded unacknowledged suffix. */
  observe(message) {
    if (!this.simulation) return;
    if (!this.acceptObserved(message)) return;
    this.measure(message);
    this.connectionEpoch = message.connectionEpoch;
    this.fieldEpoch = message.fieldEpoch;
    this.serverTick = message.serverTick;
    this.lastObservedAt = performance.now();
    this.ackInputSeq = message.ackInputSeq ?? this.ackInputSeq;
    this.paused = message.paused;
    const wasReady = this.ready;
    const visibleX = this.simulation.x;
    const visibleY = this.simulation.y;
    this.ready = true;
    // A reported divert is placed at the tick that integrated it and replayed from the
    // published pre-impulse base, so the suffix is re-derived instead of overwritten.
    // When it cannot be placed the authoritative state is adopted as before.
    const explained = !this.paused && this.replayDiverts(message);
    if (!explained && this.ready) this.adoptCheckpoint(message, message.motion);
    // Initial synchronization adopts the authoritative state outright; only an
    // already-presented pose is glided onto a later correction.
    if (wasReady) this.reconcilePresentation(visibleX, visibleY, explained);
  }

  /** Reject a checkpoint from a retired connection or field, or an old tick. */
  acceptObserved(message) {
    if (
      this.connectionEpoch &&
      (message.connectionEpoch !== this.connectionEpoch ||
        message.fieldEpoch !== this.fieldEpoch)
    ) {
      this.requestResync();
      return false;
    }
    if (message.serverTick < this.serverTick) return false;
    if (
      message.ackInputSeq !== null &&
      message.ackInputSeq < this.ackInputSeq
    ) {
      throw new Error("Input acknowledgement regressed");
    }
    return true;
  }

  /** Adopt one authoritative checkpoint wholesale and replay the retained suffix. */
  adoptCheckpoint(message, motion) {
    restoreMotion(this.simulation, motion);
    this.observeJump(motion.groundJumpSequence);
    assignHeldInput(this.held, motion.held);
    this.held.jumpPressed = false;
    this.held.attackPressed = false;
    this.retireHistory();
    this.predictedTick = message.serverTick;
    if (this.paused) {
      this.head = 0;
      this.count = 0;
      this.catchUpDebt = 0;
    } else this.replay();
  }

  /** Place authoritative diverts at the tick that first integrated them: restore the
   *  published pre-impulse checkpoint, merge the same vectors through the same kernel
   *  `applyExternalImpulse`, and re-step the retained input suffix forward. Reports
   *  false — without committing to the result — when the record cannot be placed
   *  safely, so the caller keeps the existing authoritative-adoption behaviour. */
  replayDiverts(message) {
    const diverts = message.diverts;
    if (!validDivertRecords(diverts, message.serverTick)) return false;
    // The impulse is integrated by `tick`, so its own history entry must still be
    // retained. A retired tick is a resync boundary, never a replayed guess.
    if (this.entryIndex(message.serverTick) < 0) return false;
    const before = diverts[0].before;
    restoreMotion(this.simulation, before);
    assignHeldInput(this.held, before.held);
    this.held.jumpPressed = false;
    this.held.attackPressed = false;
    this.observeJump(before.groundJumpSequence);
    this.retireHistoryTo(message.serverTick - 1);
    this.predictedTick = message.serverTick - 1;
    for (const divert of diverts) {
      applyExternalImpulse(this.simulation, divert.vx, divert.vy);
    }
    const probe = {
      tick: message.serverTick,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      captured: false,
    };
    this.replay({ probe, collapseAcknowledged: false });
    if (!this.ready || !divertReproduced(probe, message.motion)) return false;
    this.diverts++;
    return true;
  }

  /** Absorb a bounded server correction in presentation space: the drawn pose stays where
   *  the player saw it and glides onto the authoritative state over one short interval.
   *  A disagreement beyond the tolerance is a real desync and snaps immediately. */
  reconcilePresentation(visibleX, visibleY, explained = false) {
    this.seedCorrection(visibleX, visibleY, explained);
  }
  seedCorrection(visibleX, visibleY, explained = false) {
    const dx = visibleX - this.simulation.x;
    const dy = visibleY - this.simulation.y;
    const distance = Math.hypot(dx, dy);
    const limit = explained ? DIVERT_CORRECTION_MAX_PX : POSITION_TOLERANCE_PX;
    if (!Number.isFinite(distance) || distance > limit) {
      this.correctionX = 0;
      this.correctionY = 0;
      this.correctionUntil = 0;
      this.correctionSpan = CORRECTION_MS;
      return;
    }
    this.correctionX = dx;
    this.correctionY = dy;
    this.correctionSpan = Math.max(
      CORRECTION_MS,
      distance / DIVERT_CORRECTION_PX_PER_MS,
    );
    this.correctionUntil = performance.now() + this.correctionSpan;
  }

  measure(message) {
    const diverted =
      Array.isArray(message.diverts) && message.diverts.length > 0;
    for (let index = 0; index < this.count; index++) {
      const entry = this.history[(this.head + index) % this.history.length];
      if (entry.targetTick !== message.serverTick) continue;
      this.lastPositionError = Math.hypot(
        entry.x - message.motion.x,
        entry.y - message.motion.y,
      );
      this.lastVelocityError = Math.hypot(
        entry.vx - message.motion.vx,
        entry.vy - message.motion.vy,
      );
      this.maximumPositionError = Math.max(
        this.maximumPositionError,
        this.lastPositionError,
      );
      // An announced divert is expected divergence and is counted separately.
      if (
        !diverted &&
        (this.lastPositionError > 0.001 || this.lastVelocityError > 0.001)
      ) {
        this.corrections++;
      }
      break;
    }
  }

  /** Only new server-accepted ground/drop jumps cue audio; replay and rejoin are silent. */
  observeJump(sequence) {
    const previous = this.groundJumpSequence;
    this.groundJumpSequence = sequence;
    if (previous === null) return;
    const delta = (sequence - previous) >>> 0;
    if (delta > 0 && delta < 0x80000000) this.onGroundJump?.();
  }

  retireHistory() {
    this.retireHistoryTo(this.serverTick);
  }

  /** Retire every entry at or before `tick`; a divert keeps its own entry alive. */
  retireHistoryTo(tick) {
    for (let count = 0; count < this.history.length && this.count; count++) {
      const entry = this.history[this.head];
      if (entry.targetTick > tick) break;
      this.head = (this.head + 1) % this.history.length;
      this.count--;
    }
  }

  /** Index of the retained entry sampled for `tick`, or -1 when it is not retained. */
  entryIndex(tick) {
    for (let index = 0; index < this.count; index++) {
      const entry = this.history[(this.head + index) % this.history.length];
      if (entry.targetTick === tick) return index;
      if (entry.targetTick > tick) break;
    }
    return -1;
  }

  /** Re-step the retained suffix. `options.probe` captures the kernel state at one
   *  tick; `options.collapseAcknowledged` is disabled when reproducing a divert tick
   *  whose own recorded input must be used rather than the latest held state. */
  replay(options = null) {
    const probe = options?.probe ?? null;
    const collapse = options?.collapseAcknowledged !== false;
    for (let index = 0; index < this.count; index++) {
      const entry = this.history[(this.head + index) % this.history.length];
      if (entry.targetTick !== this.predictedTick + 1) {
        this.requestResync();
        return;
      }
      this.prepareEntryReplay(entry, collapse);
      assignHeldInput(this.held, entry);
      this.applyAction(entry);
      stepMotion(this.simulation, this.held);
      this.recordPose(entry);
      this.captureProbe(probe, entry);
      this.predictedTick = entry.targetTick;
      this.replayedTicks++;
    }
  }

  /** An acknowledged input is already reflected in the authoritative checkpoint, so the
   *  newest held state replaces it; a divert tick keeps its own recorded input. */
  prepareEntryReplay(entry, collapse) {
    if (collapse && entry.inputSeq > 0 && entry.inputSeq <= this.ackInputSeq) {
      entry.inputSeq = 0;
    }
    if (entry.inputSeq === 0) this.copyHeld(entry);
  }

  captureProbe(probe, entry) {
    if (!probe || probe.captured || entry.targetTick !== probe.tick) return;
    probe.x = this.simulation.x;
    probe.y = this.simulation.y;
    probe.vx = this.simulation.vx;
    probe.vy = this.simulation.vy;
    probe.captured = true;
  }

  /** Optimistic movement-skill impulse for the next predicted tick; retired with its entry. */
  queueAction(action) {
    if (!action) return;
    this.queuedAction = action;
  }
  applyAction(entry) {
    if (entry.action?.kind !== "impulse") return;
    applyExternalImpulse(this.simulation, entry.action.vx, entry.action.vy);
  }

  /** Admit scheduler work only while the installed simulation has fresh authenticated timing. */
  canAdvance(now) {
    const timing = this.timingState;
    if (
      !this.ready ||
      !this.simulation ||
      this.paused ||
      !timing?.ready ||
      timing.paused ||
      timing.connectionEpoch !== this.connectionEpoch ||
      timing.fieldEpoch !== this.fieldEpoch
    ) {
      return false;
    }
    if (!Number.isFinite(now) || now < this.lastObservedAt) {
      throw new Error("Invalid prediction scheduler clock");
    }
    if (now - timing.receivedAt > STALE_OBSERVATION_MS) {
      this.requestResync();
      return false;
    }
    return true;
  }

  /** now is the local scheduler clock used only to pace bounded server-tick input hints. */
  advance(now, held) {
    if (!this.canAdvance(now)) return 0;
    const timing = this.timingState;
    this.arrivalTick = Math.max(
      timing.serverTick,
      Math.floor(
        (now + timing.oneWayMs + timing.tickOffsetMs) / PROTOCOL.TICK_MS,
      ),
    );
    // RTT and timer drift are estimates; only received field ticks grant lead.
    // At high latency the server may retire late hints rather than accept excess lead.
    const desired = Math.min(
      this.arrivalTick + PROTOCOL.INPUT_BUFFER_TICKS,
      timing.serverTick + PROTOCOL.INPUT_LEAD_TICKS,
    );
    let steps = 0;
    for (
      ;
      steps < PROTOCOL.MAX_CATCH_UP && this.predictedTick < desired;
      steps++
    ) {
      if (this.count >= this.history.length) {
        this.requestResync();
        break;
      }
      if (!this.predict(held, this.predictedTick + 1 === desired)) break;
    }
    if (steps) this.lastStepAt = now;
    this.catchUpDebt = Math.max(0, desired - this.predictedTick);
    return steps;
  }

  /** Browser presentation of the newest two authenticated 30 ms kernel states.
   * The scheduler's actual step time is the interpolation anchor, so timer jitter
   * stretches one quantum instead of stalling the drawn pose; replay and correction
   * never move the anchor because they reproduce states that were already presented.
   * @param {number} now Local scheduler time in milliseconds.
   * @param {{x:number,y:number}} target Reused pose scratch; never allocated per frame.
   */
  interpolate(now, target) {
    const sim = this.simulation;
    if (!sim) return target;
    let alpha = 1;
    if (this.ready && this.lastStepAt > 0 && Number.isFinite(now)) {
      alpha = (now - this.lastStepAt) / sim.effectiveSettings.quantumMs;
      alpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    }
    target.x = sim.previousX + (sim.x - sim.previousX) * alpha;
    target.y = sim.previousY + (sim.y - sim.previousY) * alpha;
    const remaining = this.correctionUntil - now;
    if (remaining > 0) {
      let fraction = remaining / this.correctionSpan;
      if (fraction > 1) fraction = 1;
      target.x += this.correctionX * fraction;
      target.y += this.correctionY * fraction;
    }
    return target;
  }

  predict(held, transmit) {
    const sample = this.sample;
    sample.targetTick = this.predictedTick + 1;
    this.copyInput(sample, transmit ? held : this.held);
    // The state this sample extends, at the end of targetTick - 1: the server compares
    // it with its own simulation for the same tick before stepping. -0 is not a legal
    // wire scalar, so it is normalized here rather than rejected at encode time.
    this.copyMotion(sample.motion);
    const inputSeq = transmit ? this.onInput?.(sample) : 0;
    if (inputSeq === null || inputSeq === undefined) return false;
    if (!Number.isSafeInteger(inputSeq) || inputSeq < (transmit ? 1 : 0)) {
      throw new Error("Input sender must return admitted sequence");
    }
    const entry = this.history[(this.head + this.count) % this.history.length];
    entry.inputSeq = inputSeq;
    entry.targetTick = sample.targetTick;
    entry.horizontal = sample.horizontal;
    entry.vertical = sample.vertical;
    entry.jump = sample.jump;
    entry.attack = sample.attack;
    entry.action = this.queuedAction;
    this.queuedAction = null;
    assignHeldInput(this.held, sample);
    this.applyAction(entry);
    stepMotion(this.simulation, this.held);
    this.recordPose(entry);
    this.count++;
    if (!transmit) this.filledTicks++;
    this.predictedTick++;
    return true;
  }

  copyInput(target, held) {
    target.horizontal =
      Number(Boolean(held.right)) - Number(Boolean(held.left));
    target.vertical = Number(Boolean(held.down)) - Number(Boolean(held.up));
    target.jump = Boolean(held.jump);
    target.attack = Boolean(held.attack);
  }

  copyHeld(target) {
    this.copyInput(target, this.held);
  }

  /** Locally predicted motion for a resume handshake. The client is the source of truth
   *  for its own position, so a reconnect offers where it actually is instead of being
   *  snapped back to the last state the server happened to checkpoint. */
  resumeMotion() {
    if (!this.simulation) return null;
    const motion = { x: 0, y: 0, vx: 0, vy: 0 };
    this.copyMotion(motion);
    return motion;
  }

  /** Bounded local prediction for the server's adoption check; never a rule input. */
  copyMotion(target) {
    const sim = this.simulation;
    target.x = normalizeZero(sim.x);
    target.y = normalizeZero(sim.y);
    target.vx = normalizeZero(sim.vx);
    target.vy = normalizeZero(sim.vy);
  }

  recordPose(entry) {
    entry.x = this.simulation.x;
    entry.y = this.simulation.y;
    entry.vx = this.simulation.vx;
    entry.vy = this.simulation.vy;
  }

  requestResync() {
    if (!this.ready) return;
    this.ready = false;
    this.overflows++;
    this.onResync?.("prediction-overflow");
  }

  clear() {
    this.groundJumpSequence = null;
    this.ready = false;
    this.paused = false;
    this.simulation = null;
    this.head = 0;
    this.count = 0;
    this.connectionEpoch = null;
    this.fieldEpoch = null;
    this.ackInputSeq = 0;
    this.catchUpDebt = 0;
    this.lastStepAt = 0;
    this.queuedAction = null;
    this.correctionX = 0;
    this.correctionY = 0;
    this.correctionUntil = 0;
    this.correctionSpan = CORRECTION_MS;
  }

  snapshot() {
    return Object.freeze({
      ready: this.ready,
      paused: this.paused,
      serverTick: this.serverTick,
      predictedTick: this.predictedTick,
      history: this.count,
      ackInputSeq: this.ackInputSeq,
      corrections: this.corrections,
      maximumPositionError: this.maximumPositionError,
      lastPositionError: this.lastPositionError,
      lastVelocityError: this.lastVelocityError,
      replayedTicks: this.replayedTicks,
      timing: this.timingState,
      arrivalTick: this.arrivalTick,
      filledTicks: this.filledTicks,
      overflows: this.overflows,
      catchUpDebt: this.catchUpDebt,
      diverts: this.diverts,
    });
  }
}
