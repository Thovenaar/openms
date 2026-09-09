/**
 * @typedef {object} ScenarioHooks
 * @property {(spec: object) => Promise<object>} enter Atomically swap and return the complete baseline.
 * @property {() => Promise<void>} exit Idempotently restore the original scene/store.
 * @property {(ticks: number) => void} step Synchronous paused-only work, at most eight ticks.
 * @property {(command: object) => Promise<{accepted:boolean}>} dispatch Normal admission outcome.
 * @property {() => void} clearInput Clear agent holds only when no human takeover has occurred.
 * @property {() => void} assertControl Throw unless an opted-in active lease owns control.
 * @property {() => number} controlGeneration Monotonic controller generation.
 * @property {() => {buildId: string}} describe Current asset/source build identity.
 */

import { validateProfile } from "./profile-validation.js";
import { validatePlayerCommand } from "./player-actions.js";

/** Browser engineering bounds, not recovered original gameplay policies. */
const QUANTUM_MS = 30;
const MAX_STEP_TICKS = 8;
const MAX_TICKS = 120000;
const MAX_ACTIONS = 16384;
const MAX_ACTIONS_PER_YIELD = 64;
const DEFAULT_SEED = 0x6d2b79f5;
const GLOBAL_KEYS = [
  "walkForce",
  "walkSpeed",
  "walkDrag",
  "slipForce",
  "slipSpeed",
  "floatDrag1",
  "floatDrag2",
  "floatCoefficient",
  "swimForce",
  "swimSpeed",
  "flyForce",
  "flySpeed",
  "gravityAcc",
  "fallSpeed",
  "jumpSpeed",
  "maxFriction",
  "minFriction",
  "swimSpeedDec",
  "flyJumpDec",
];

/** Reject unknown fields before cloning, loading assets, or changing scenario ownership. */
function objectKeys(value, allowed, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a plain object.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length) throw new Error(`Too many ${name} fields.`);
  for (const key of keys) {
    if (
      !allowed.includes(key) ||
      !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")
    ) {
      throw new Error(`Unknown or non-data ${name} field: ${String(key)}`);
    }
  }
}

/** Tick counts are integral fixed quanta, never wall-clock delays. */
function tickCount(value, maximum = MAX_TICKS) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`Ticks must be an integer from 0 through ${maximum}.`);
  }
}

/** These are only the consumers proven in physics/settings.js, not arbitrary source policies. */
function validatePhysics(physics) {
  objectKeys(physics, ["globals", "map"], "physics");
  if (physics.globals !== undefined) {
    objectKeys(physics.globals, GLOBAL_KEYS, "physics.globals");
    for (const key of Object.keys(physics.globals)) {
      if (!Number.isFinite(physics.globals[key]) || physics.globals[key] <= 0) {
        throw new RangeError(
          `physics.globals.${key} must be finite and positive.`,
        );
      }
    }
    if (physics.globals.minFriction > physics.globals.maxFriction) {
      throw new RangeError("Reversed physics friction clamps.");
    }
  }
  if (physics.map !== undefined) {
    objectKeys(physics.map, ["fs"], "physics.map");
    if (
      Object.hasOwn(physics.map, "fs") &&
      (!Number.isFinite(physics.map.fs) || physics.map.fs < 0)
    ) {
      throw new RangeError("physics.map.fs must be finite and nonnegative.");
    }
  }
}

/** Validate and own the scenario baseline; Main resolves omitted profile/map before publishing it. */
function validateSpec(value) {
  objectKeys(value, ["mapId", "profile", "physics", "seed"], "scenario");
  if (
    value.mapId !== undefined &&
    (typeof value.mapId !== "string" || !/^\d{9}$/.test(value.mapId))
  ) {
    throw new TypeError("Scenario mapId must be a nine-digit string.");
  }
  if (value.profile !== undefined) validateProfile(value.profile);
  if (value.physics !== undefined) validatePhysics(value.physics);
  const seed = value.seed === undefined ? DEFAULT_SEED : value.seed;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("Scenario seed must be uint32.");
  }
  return { ...structuredClone(value), seed };
}

/** Recordings require an explicit initial profile, never whatever progress happens to be loaded. */
function requireBaseline(spec) {
  if (
    !spec.profile ||
    !spec.mapId ||
    spec.profile.location.mapId !== spec.mapId
  ) {
    throw new Error(
      "Scenario baseline must include its full profile and matching resolved mapId.",
    );
  }
}

/** Build identity is an exact match, not a best-effort compatibility guess. */
function buildIdentity(hooks) {
  const buildId = hooks.describe()?.buildId;
  if (typeof buildId !== "string" || !buildId || buildId.length > 256) {
    throw new Error(
      "Scenario requires a nonempty buildId of at most 256 characters.",
    );
  }
  return buildId;
}

/** Validate every command and offset before the first enter/exit/dispatch mutation. */
function validateRecording(value, buildId) {
  objectKeys(
    value,
    [
      "schemaVersion",
      "mode",
      "quantumMs",
      "buildId",
      "spec",
      "actions",
      "totalTicks",
    ],
    "recording",
  );
  if (
    value.schemaVersion !== 1 ||
    value.mode !== "fixed-tick" ||
    value.quantumMs !== QUANTUM_MS
  ) {
    throw new Error(
      "Only schema1 fixed-tick 30ms recordings are deterministic; wall-clock playback is unsupported.",
    );
  }
  if (value.buildId !== buildId) throw new Error("Recording build mismatch.");
  tickCount(value.totalTicks);
  const spec = validateSpec(value.spec);
  requireBaseline(spec);
  if (!Array.isArray(value.actions) || value.actions.length > MAX_ACTIONS) {
    throw new RangeError(`Recording supports at most ${MAX_ACTIONS} actions.`);
  }
  let previousTick = 0;
  for (const entry of value.actions) {
    objectKeys(entry, ["tick", "command", "accepted"], "recorded action");
    if (typeof entry.accepted !== "boolean") {
      throw new TypeError("Recorded admission outcome must be boolean.");
    }
    tickCount(entry.tick, value.totalTicks);
    if (entry.tick < previousTick) {
      throw new Error("Recorded tick offsets must be ordered.");
    }
    validatePlayerCommand(entry.command);
    previousTick = entry.tick;
  }
  return { ...structuredClone(value), spec };
}

/** Yield a browser task so trusted native interruption can run, not merely a promise microtask. */
function yieldTask() {
  return new Promise(scheduleTask);
}

/** Named timer callback ownership: one finite pending yield per replay. */
function scheduleTask(resolve) {
  setTimeout(resolve, 0);
}

/**
 * Opt-in, fixed-tick temporary scenarios; no gameplay RNG consumers are altered.
 * hooks.enter(spec) atomically returns canonical {mapId, profile, physics?, seed}.
 * hooks.exit() clears holds and restores the suspended durable baseline, even after revocation.
 * hooks.step(n) is synchronous, paused-only, and calls tick(30) once per executed quantum.
 * hooks.dispatch(command) uses normal admission; hooks.clearInput() is a synchronous safety clear.
 * hooks.assertControl(), controlGeneration(), describe() enforce ownership/build identity.
 */
export class AgentScenarios {
  /** @param {ScenarioHooks} hooks Explicit runtime ownership and normal-action adapters. */
  constructor(hooks) {
    this.hooks = hooks;
    this._spec = null;
    this._ticks = 0;
    this._randomState = DEFAULT_SEED;
    this._commandCount = 0;
    this._recording = null;
    this._recordGeneration = null;
    this._busy = false;
    this._replaying = false;
    this._buildId = null;
  }

  get replaying() {
    return this._replaying;
  }
  get pending() {
    return this._busy;
  }
  get recording() {
    return this._recording !== null;
  }

  /** Cheap scenario clock in milliseconds; Main uses performance.now outside temporary ownership. */
  now() {
    return this._ticks * QUANTUM_MS;
  }

  /** Main calls once per actual simulation quantum, including human play after takeover. No allocation. */
  tick(ms) {
    if (!this._spec) return;
    if (ms !== QUANTUM_MS) {
      throw new RangeError("Scenario clock requires exactly 30ms per tick.");
    }
    if (this._ticks >= MAX_TICKS) {
      throw new RangeError(
        "Scenario duration limit reached; end or restart it.",
      );
    }
    this._ticks++;
  }

  /** Capture this lease before an await and compare it afterward; reacquisition cannot revive old work. */
  _lease(generation) {
    this.hooks.assertControl();
    const current = this.hooks.controlGeneration();
    if (generation !== undefined && current !== generation) {
      throw new Error("Scenario control was interrupted.");
    }
    return current;
  }

  /** No concurrent begin/end/step/replay, and no recording-baseline replacement. */
  _idle() {
    if (this._busy) {
      throw new Error(
        "Scenario operation already pending; commands are not queued.",
      );
    }
  }

  /** Begin is reversible; Main retains the original scene/store without mutating it. */
  async begin(spec = {}) {
    this._idle();
    if (this._spec) {
      throw new Error("End the active scenario before beginning another.");
    }
    const validated = validateSpec(spec);
    const generation = this._lease();
    this._busy = true;
    try {
      await this._enter(validated, generation);
    } finally {
      this._busy = false;
    }
    return this.snapshot();
  }

  /** Failed setup unwinds only under the same lease; native takeover must retain its new human input. */
  async _enter(spec, generation) {
    const buildId = buildIdentity(this.hooks);
    try {
      const entered = await this.hooks.enter(structuredClone(spec));
      const canonical = validateSpec(entered);
      requireBaseline(canonical);
      this._spec = canonical;
      this._ticks = 0;
      this._randomState = canonical.seed;
      this._commandCount = 0;
      this._recording = null;
      this._buildId = buildId;
      this._lease(generation);
    } catch (error) {
      if (this.hooks.controlGeneration() === generation) await this._exit();
      throw error;
    }
  }

  /** Safety restoration does not require an active lease; no permission can trap a temporary store. */
  async end() {
    this._idle();
    this._busy = true;
    try {
      await this._exit();
    } finally {
      this._busy = false;
    }
    return this.snapshot();
  }

  /** Main exit is idempotent and must finish ownership restoration before resolving. */
  async _exit() {
    this.hooks.clearInput();
    await this.hooks.exit();
    this._clear();
  }

  /** Release owned metadata only after Main has successfully restored the suspended field. */
  _clear() {
    this._spec = null;
    this._recording = null;
    this._ticks = 0;
    this._commandCount = 0;
    this._buildId = null;
  }

  /** Execute at most eight paused fixed ticks; Main tick() is the sole clock writer. */
  async step(ticks) {
    this._idle();
    tickCount(ticks, MAX_STEP_TICKS);
    const generation = this._lease();
    this._busy = true;
    try {
      await this._step(ticks, generation);
    } finally {
      this._busy = false;
    }
    return this.snapshot();
  }

  /** Internal replay stepping shares exactly the public step invariants. */
  async _step(ticks, generation) {
    this._lease(generation);
    if (!this._spec) {
      throw new Error("Begin a temporary scenario before stepping.");
    }
    if (this._ticks + ticks > MAX_TICKS) {
      throw new RangeError("Scenario duration limit reached.");
    }
    const expected = this._ticks + ticks;
    for (let transitions = 0; transitions <= 32; transitions++) {
      this.hooks.step(expected - this._ticks);
      this._lease(generation);
      if (this._ticks > expected) {
        throw new Error("Scenario advanced beyond requested ticks.");
      }
      if (this.hooks.isLoading?.()) {
        await this.hooks.waitReady();
        this._lease(generation);
      }
      if (this._ticks === expected) return;
      if (!this.hooks.isLoading?.() && ticks === 0) {
        throw new Error(
          "Scenario step did not advance the requested fixed ticks.",
        );
      }
    }
    throw new Error("Scenario portal transition limit exceeded.");
  }

  /** A recording must start at the canonical baseline, before any commands or simulation work. */
  startRecording() {
    this._idle();
    this._lease();
    if (
      !this._spec ||
      this._ticks !== 0 ||
      this._commandCount !== 0 ||
      this._recording
    ) {
      throw new Error(
        "Start recording immediately after begin, before ticks or commands.",
      );
    }
    this._recording = {
      schemaVersion: 1,
      mode: "fixed-tick",
      quantumMs: QUANTUM_MS,
      buildId: this._buildId,
      spec: structuredClone(this._spec),
      actions: [],
      totalTicks: 0,
    };
    this._recordGeneration = this.hooks.controlGeneration();
    return this.snapshot();
  }

  /** Main calls before dispatch; collection exhaustion must fail before a command mutates gameplay. */
  assertCanRecord() {
    if (!this._spec || this._replaying) return;
    this._checkRecordingLease();
    if (this._commandCount >= MAX_ACTIONS) {
      throw new RangeError("Scenario action limit reached.");
    }
  }

  /** Trusted takeover invalidates a partial recording because its human commands are not captured. */
  _checkRecordingLease() {
    if (
      this._recording &&
      this._recordGeneration !== this.hooks.controlGeneration()
    ) {
      this._recording = null;
      throw new Error(
        "Recording invalidated by human takeover or lease change.",
      );
    }
  }

  /** Record every well-formed attempted command, including observable normal refusals. */
  record(command, accepted) {
    if (!this._spec || this._replaying) return;
    this.assertCanRecord();
    validatePlayerCommand(command);
    if (this._recording) {
      this._recording.actions.push({
        tick: this._ticks,
        command: structuredClone(command),
        accepted,
      });
    }
    this._commandCount++;
  }

  /** The final duration retains idle trailing ticks and final held keys without inventing releases. */
  stopRecording() {
    this._idle();
    this._checkRecordingLease();
    if (!this._recording) throw new Error("No scenario recording is active.");
    this._recording.totalTicks = this._ticks;
    const recording = this._recording;
    this._recording = null;
    return recording;
  }

  /** Seeded Mulberry32 tool RNG, not gameplay randomness. Deterministic for every uint32 seed. */
  random() {
    if (!this._spec) {
      throw new Error("Begin a scenario before using its tool RNG.");
    }
    this._randomState = (this._randomState + 0x6d2b79f5) >>> 0;
    let value = this._randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  /** Entire recording is checked before replacement; rejection never partially executes bad input. */
  async run(value) {
    this._idle();
    const recording = validateRecording(value, buildIdentity(this.hooks));
    const generation = this._lease();
    this._busy = true;
    this._replaying = true;
    try {
      if (this._spec) {
        await this._exit();
        this._lease(generation);
      }
      await this._enter(recording.spec, generation);
      this._lease(generation);
      await this._play(recording, generation);
      this._lease(generation);
    } catch (error) {
      if (this.hooks.controlGeneration() === generation) await this._exit();
      throw error;
    } finally {
      this._busy = false;
      this._replaying = false;
    }
    return this.snapshot();
  }

  /** At most eight ticks or 64 same-tick commands per browser turn; no queued work survives a lease. */
  async _play(recording, generation) {
    let index = 0;
    let commandsSinceYield = 0;
    while (
      index < recording.actions.length ||
      this._ticks < recording.totalTicks
    ) {
      this._lease(generation);
      const action = recording.actions[index];
      const target = action ? action.tick : recording.totalTicks;
      if (target > this._ticks) {
        await this._step(
          Math.min(MAX_STEP_TICKS, target - this._ticks),
          generation,
        );
        await yieldTask();
        this._lease(generation);
        commandsSinceYield = 0;
        continue;
      }
      const result = await this.hooks.dispatch(structuredClone(action.command));
      if (result.accepted !== action.accepted) {
        throw new Error(
          `Replay admission outcome changed at tick ${action.tick}.`,
        );
      }
      this._lease(generation);
      index++;
      commandsSinceYield++;
      if (commandsSinceYield >= MAX_ACTIONS_PER_YIELD) {
        await yieldTask();
        this._lease(generation);
        commandsSinceYield = 0;
      }
    }
  }

  /** Demand-only metadata; explicit policies distinguish experiments from recovered source behavior. */
  snapshot(includeSpec = true) {
    return {
      active: this._spec !== null,
      pending: this._busy,
      replaying: this._replaying,
      recording: this._recording !== null,
      ticks: this._ticks,
      elapsedMs: this.now(),
      quantumMs: QUANTUM_MS,
      buildId: this._buildId,
      spec: includeSpec && this._spec ? structuredClone(this._spec) : null,
      recordedActions: this._recording?.actions.length ?? 0,
      rng: {
        scope: "scenario-tool-only; no gameplay RNG consumer",
        state: this._randomState,
      },
      persistence: "temporary; Save/reset never write durable state",
      physicsPolicy:
        "experimental temporary overrides: Physics.img positive globals and map.fs only; source edits require explicit repository changes",
      limits: {
        ticks: MAX_TICKS,
        actions: MAX_ACTIONS,
        stepTicks: MAX_STEP_TICKS,
      },
    };
  }
}
