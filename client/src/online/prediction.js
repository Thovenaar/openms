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
    if (
      this.connectionEpoch &&
      (message.connectionEpoch !== this.connectionEpoch ||
        message.fieldEpoch !== this.fieldEpoch)
    ) {
      this.requestResync();
      return;
    }
    if (message.serverTick < this.serverTick) return;
    if (
      message.ackInputSeq !== null &&
      message.ackInputSeq < this.ackInputSeq
    ) {
      throw new Error("Input acknowledgement regressed");
    }
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
    restoreMotion(this.simulation, message.motion);
    this.observeJump(message.motion.groundJumpSequence);
    assignHeldInput(this.held, message.motion.held);
    this.held.jumpPressed = false;
    this.held.attackPressed = false;
    this.retireHistory();
    this.predictedTick = message.serverTick;
    this.ready = true;
    if (this.paused) {
      this.head = 0;
      this.count = 0;
      this.catchUpDebt = 0;
    } else this.replay();
    // Initial synchronization adopts the authoritative state outright; only an
    // already-presented pose is glided onto a later correction.
    if (wasReady) this.reconcilePresentation(visibleX, visibleY);
  }

  /** Absorb a bounded server correction in presentation space: the drawn pose stays where
   *  the player saw it and glides onto the authoritative state over one short interval.
   *  A disagreement beyond the tolerance is a real desync and snaps immediately. */
  reconcilePresentation(visibleX, visibleY) {
    this.seedCorrection(visibleX, visibleY);
  }
  seedCorrection(visibleX, visibleY) {
    const dx = visibleX - this.simulation.x;
    const dy = visibleY - this.simulation.y;
    if (
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      Math.hypot(dx, dy) > POSITION_TOLERANCE_PX
    ) {
      this.correctionX = 0;
      this.correctionY = 0;
      this.correctionUntil = 0;
      return;
    }
    this.correctionX = dx;
    this.correctionY = dy;
    this.correctionUntil = performance.now() + CORRECTION_MS;
  }

  measure(message) {
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
      if (this.lastPositionError > 0.001 || this.lastVelocityError > 0.001) {
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
    for (let count = 0; count < this.history.length && this.count; count++) {
      const entry = this.history[this.head];
      if (entry.targetTick > this.serverTick) break;
      this.head = (this.head + 1) % this.history.length;
      this.count--;
    }
  }

  replay() {
    for (let index = 0; index < this.count; index++) {
      const entry = this.history[(this.head + index) % this.history.length];
      if (entry.targetTick !== this.predictedTick + 1) {
        this.requestResync();
        return;
      }
      if (entry.inputSeq > 0 && entry.inputSeq <= this.ackInputSeq) {
        entry.inputSeq = 0;
      }
      if (entry.inputSeq === 0) this.copyHeld(entry);
      assignHeldInput(this.held, entry);
      this.applyAction(entry);
      stepMotion(this.simulation, this.held);
      this.recordPose(entry);
      this.predictedTick = entry.targetTick;
      this.replayedTicks++;
    }
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
      const fraction = remaining / CORRECTION_MS;
      target.x += this.correctionX * fraction;
      target.y += this.correctionY * fraction;
    }
    return target;
  }

  predict(held, transmit) {
    const sample = this.sample;
    sample.targetTick = this.predictedTick + 1;
    this.copyInput(sample, transmit ? held : this.held);
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
    });
  }
}
