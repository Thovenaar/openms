import { validateProfile } from "../profile/profile-validation.js";
import { validateAccountStorage } from "../profile/account-storage.js";
import {
  captureNativeEvent,
  listenNativeEvents,
  NATIVE_EVENT_LIMIT,
} from "./diagnostic-events.js";
import { validateScenarioRecording } from "./agent-scenarios.js";
import { validatePlayerCommand } from "../input/player-actions.js";
import { validateDiagnosticPeers } from "./diagnostic-context.js";

/** Explicit local engineering bounds; no upload endpoint or code-bearing import format. */
export const DIAGNOSTIC_BYTES = 16 * 1024 * 1024;
const MAX_NODES = 262144;
const MAX_DEPTH = 32;
const MAX_TICKS = 120000;
const MAX_JOURNAL_BYTES = 4 * 1024 * 1024;
const MAX_ERRORS = 64;
const MAX_ERROR_TEXT = 8192;

/** JSON is byte/node/depth bounded, forbids prototype keys, and never invokes input getters. */
export function parseDiagnosticJSON(text) {
  if (
    typeof text !== "string" ||
    text.length > DIAGNOSTIC_BYTES ||
    new TextEncoder().encode(text).length > DIAGNOSTIC_BYTES
  ) {
    throw new Error("Diagnostic JSON exceeds 16 MiB");
  }
  const value = JSON.parse(text);
  validateDiagnosticGraph(value);
  return value;
}

function validateDiagnosticGraph(value) {
  const queue = [{ value, depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index];
    if (entry.depth > MAX_DEPTH || queue.length > MAX_NODES) {
      throw new Error("Diagnostic JSON exceeds structural limits");
    }
    if (!entry.value || typeof entry.value !== "object") {
      if (typeof entry.value === "number" && !Number.isFinite(entry.value)) {
        throw new Error("Diagnostic number is not finite");
      }
      continue;
    }
    for (const key of Object.keys(entry.value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        throw new Error("Forbidden diagnostic property");
      }
      if (queue.length === MAX_NODES) {
        throw new Error("Diagnostic JSON exceeds node limit");
      }
      queue.push({ value: entry.value[key], depth: entry.depth + 1 });
    }
  }
}

function validateDumpEnvelope(value, identity) {
  const fields = [
    "schemaVersion",
    "kind",
    "created",
    "identity",
    "context",
    "errors",
    "recording",
    "replayable",
    "limitation",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !fields.includes(key))
  ) {
    throw new Error("Invalid diagnostic envelope");
  }
  if (value.schemaVersion !== 1 || value.kind !== "maple-local-diagnostic") {
    throw new Error("Unsupported diagnostic format");
  }
  if (
    !value.identity ||
    Object.keys(value.identity).length !== Object.keys(identity).length ||
    Object.keys(identity).some((key) => value.identity[key] !== identity[key])
  ) {
    throw new Error(
      "Diagnostic source/assets/release mismatch; exact same-build original assets are required",
    );
  }
}

function validateDumpContext(value, identity) {
  if (!value.context || (value.replayable && !value.context.profile)) {
    throw new Error("Diagnostic lacks full character context");
  }
  if (value.context.profile) validateProfile(value.context.profile);
  if (value.context.accountStorage) {
    validateAccountStorage(value.context.accountStorage, value.context.profile);
  }
  if (value.recording) {
    validateScenarioRecording(value.recording, identity.buildId);
  }
  if (value.replayable && !value.recording) {
    throw new Error("Replayable diagnostic lacks its baseline");
  }
  if (value.replayable) validateReplayContext(value.context);
  return value;
}

function validateDumpStatus(value) {
  if (
    !Array.isArray(value.errors) ||
    !value.errors.length ||
    value.errors.length > MAX_ERRORS ||
    value.errors.some(
      (error) => typeof error !== "string" || error.length > MAX_ERROR_TEXT,
    )
  ) {
    throw new Error("Invalid diagnostic errors");
  }
  if (
    typeof value.replayable !== "boolean" ||
    typeof value.limitation !== "string" ||
    value.limitation.length > MAX_ERROR_TEXT ||
    typeof value.created !== "string"
  ) {
    throw new Error("Invalid diagnostic status");
  }
}

function validDump(value, identity) {
  validateDumpEnvelope(value, identity);
  validateDumpStatus(value);
  return validateDumpContext(value, identity);
}

function validateReplayContext(context) {
  if (typeof context.mapId !== "string" || !/^\d{9}$/.test(context.mapId)) {
    throw new Error("Invalid diagnostic map");
  }
  for (const key of ["simulation", "world", "random", "ui"]) {
    if (
      !context[key] ||
      typeof context[key] !== "object" ||
      Array.isArray(context[key])
    ) {
      throw new Error(`Invalid diagnostic ${key}`);
    }
  }
  if (
    !Number.isInteger(context.random.state) ||
    context.random.state < 0 ||
    context.random.state > 0xffffffff
  ) {
    throw new Error("Invalid diagnostic random state");
  }
  validateDiagnosticPeers(context.peers, context.characterId);
}

/** Chromium's CDP IME end is untrusted; only a captured native start can admit it. */
function nativeOrigin(event, compositionTarget) {
  return (
    event.isTrusted ||
    (event.type === "compositionend" && event.target === compositionTarget)
  );
}

/** Retains one initial baseline and a finite action journal, never a history of state snapshots. */
export class GameDiagnostics {
  constructor(hooks) {
    this.hooks = hooks;
    this.controller = new AbortController();
    this.baseline = null;
    this.actions = [];
    this.ticks = 0;
    this.clockTicks = 0;
    this.bytes = 0;
    this.limitation = "No complete initial field baseline was available";
    this.latest = null;
    this.imported = null;
    this.capturing = false;
    this.compositionTarget = null;
    this.replaying = false;
    this.replayErrors = [];
    this.cancelled = false;
    this.randomState = crypto.getRandomValues(new Uint32Array(1))[0];
    this.initialRandomState = this.randomState;
    this.event = this.event.bind(this);
    listenNativeEvents(this.event, this.controller.signal);
    const focusLoss = (event) => {
      if (event.type === "blur" || document.hidden) {
        if (this.replaying) this.cancel();
        else {
          this.invalidate(
            "Browser focus or visibility changed outside the native replay surface",
          );
        }
      }
    };
    window.addEventListener("blur", focusLoss, {
      signal: this.controller.signal,
    });
    window.addEventListener("visibilitychange", focusLoss, {
      capture: true,
      signal: this.controller.signal,
    });
  }

  /** One baseline at the first fresh field, not an invented mid-world state restoration. */
  begin() {
    if (this.baseline || this.replaying) return;
    try {
      const context = this.hooks.context();
      if (!this.hooks.identity().buildId) {
        throw new Error(
          "Exact source and original-asset identity is unavailable",
        );
      }
      validateProfile(context.profile);
      validateAccountStorage(context.accountStorage, context.profile);
      this.baseline = {
        schemaVersion: 2,
        mode: "native-fixed-tick",
        quantumMs: 30,
        buildId: this.hooks.identity().buildId,
        spec: {
          mapId: context.mapId,
          profile: context.profile,
          characterId: context.characterId,
          accountStorage: context.accountStorage,
          peers: context.peers,
          seed: this.initialRandomState,
        },
        initialUI: {
          windows: context.ui.windows,
          positions: context.ui.positions,
          viewport: {
            width: context.viewport.width,
            height: context.viewport.height,
          },
        },
        actions: [],
        totalTicks: 0,
      };
      this.limitation = "";
    } catch (error) {
      this.limitation = `Baseline unavailable: ${error.message}`;
    }
  }

  /** Increment only, with no per-tick object/array/snapshot allocation. */
  tick() {
    if (!this.replaying) this.clockTicks++;
    if (!this.replaying) this.failureTick = null;
    if (!this.baseline || this.replaying || this.limitation) return;
    if (this.ticks === MAX_TICKS) {
      this.limitation = "Native journal reached its 120000-tick limit";
    } else this.ticks++;
  }

  simulationFailure(before, executedQuanta = 0) {
    if (this.replaying || !this.baseline) return;
    const attempted = Math.max(
      this.ticks,
      before + Math.max(1, executedQuanta),
    );
    if (attempted > MAX_TICKS) {
      this.limitation = "Failed quantum exceeded the journal tick bound";
    } else this.failureTick = attempted;
  }

  random() {
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  event(event) {
    if (!nativeOrigin(event, this.compositionTarget)) return;
    if (this.replaying) {
      if (event.type === "keydown" || event.type === "pointerdown") {
        this.cancel();
      }
      return;
    }
    if (!this.baseline || this.limitation) return;
    try {
      const native = captureNativeEvent(event, this.hooks);
      if (!native) return;
      if (native.type === "compositionstart") {
        this.compositionTarget = event.target;
      }
      if (native.type === "compositionend") this.compositionTarget = null;
      this.append({ tick: this.ticks, native, accepted: true });
    } catch (error) {
      this.limitation = error.message;
    }
  }

  /** Save checkpoints are observer-driven native state changes, not an imported mutation API. */
  checkpoint() {
    if (!this.baseline || this.replaying || this.limitation) return;
    try {
      const native = captureNativeEvent(
        { type: "profile-checkpoint", target: this.hooks.canvas },
        this.hooks,
      );
      this.append({ tick: this.ticks, native, accepted: true });
    } catch (error) {
      this.limitation = error.message;
    }
  }

  invalidate(reason) {
    if (!this.replaying) this.limitation = reason;
  }

  viewportChanged(width, height) {
    const recording = this.replaying ? this.activeRecording : this.baseline;
    const viewport = recording?.initialUI.viewport;
    if (!viewport || (viewport.width === width && viewport.height === height)) {
      return;
    }
    if (this.replaying) this.cancel();
    else {
      this.invalidate(
        "Gameplay viewport changed after the native recording baseline",
      );
    }
  }

  /** Normal agent commands use the same bounded journal as human events, including refusals. */
  command(command) {
    if (!this.baseline || this.replaying || this.limitation) return null;
    try {
      validatePlayerCommand(command);
      const entry = {
        tick: this.ticks,
        command: structuredClone(command),
        accepted: false,
      };
      this.append(entry);
      return entry;
    } catch (error) {
      this.limitation = error.message;
      return null;
    }
  }

  append(entry) {
    if (this.actions.length === NATIVE_EVENT_LIMIT) {
      throw new Error("Native journal reached its 8192-event limit");
    }
    this.bytes += JSON.stringify(entry).length * 2;
    if (this.bytes > MAX_JOURNAL_BYTES) {
      throw new Error("Native journal reached its 4 MiB limit");
    }
    this.actions.push(entry);
  }

  /** Capture is synchronous and nonrecursive; failure remains diagnostic text, never re-enters logging. */
  capture(text) {
    if (this.replaying) {
      if (this.replayErrors.length < MAX_ERRORS) {
        this.replayErrors.push(text.slice(0, MAX_ERROR_TEXT));
      }
      return;
    }
    if (this.capturing) return;
    this.capturing = true;
    try {
      const recording = this.baseline
        ? {
            ...this.baseline,
            actions: this.actions,
            totalTicks: this.failureTick ?? this.ticks,
          }
        : null;
      const dump = {
        schemaVersion: 1,
        kind: "maple-local-diagnostic",
        created: new Date().toISOString(),
        identity: this.hooks.identity(),
        context: this.hooks.context(),
        errors: [text.slice(0, MAX_ERROR_TEXT)],
        recording,
        replayable: Boolean(recording && !this.limitation),
        limitation: this.limitation,
      };
      const encoded = JSON.stringify(dump);
      if (encoded.length > DIAGNOSTIC_BYTES) {
        throw new Error("Captured state exceeds diagnostic byte limit");
      }
      parseDiagnosticJSON(encoded);
      this.latest = encoded;
    } catch (error) {
      this.latest = null;
      this.captureFailure = `Diagnostic capture failed: ${error.message}`;
    } finally {
      this.capturing = false;
    }
  }

  importJSON(text) {
    if (this.replaying) {
      throw new Error("Finish replay before importing another dump");
    }
    this.imported = validDump(parseDiagnosticJSON(text), this.hooks.identity());
    return this.imported.replayable
      ? "Validated local dump. Replay runs in a temporary world."
      : `Captured context only: ${this.imported.limitation}`;
  }

  exportJSON() {
    if (!this.latest) {
      throw new Error(
        this.captureFailure ?? "No error diagnostic is available",
      );
    }
    return this.latest;
  }

  cancel() {
    this.cancelled = true;
    this.replayController?.abort();
    this.hooks.cancel();
  }

  assertActive() {
    if (!this.replaying || this.cancelled) {
      throw new DOMException("Local diagnostic replay cancelled", "AbortError");
    }
  }

  /** Native Replay authorizes only this validated dump; it does not grant an AgentControl lease. */
  async replay() {
    if (this.replaying) throw new Error("Diagnostic replay already active");
    const dump = validDump(
      this.imported ?? parseDiagnosticJSON(this.exportJSON()),
      this.hooks.identity(),
    );
    if (!dump.replayable) {
      throw new Error(`Non-replayable capture: ${dump.limitation}`);
    }
    this.hooks.admit(dump.recording);
    this.activeRecording = dump.recording;
    this.replayController = new AbortController();
    this.replaying = true;
    this.cancelled = false;
    this.replayErrors.length = 0;
    const deadline = setTimeout(() => this.cancel(), 120000);
    let failure = null;
    let comparison = null;
    try {
      await this.hooks.run(dump.recording);
      comparison = this.hooks.compare(dump.context);
    } catch (error) {
      failure = error;
      if (this.replayErrors.length < MAX_ERRORS) {
        this.replayErrors.push(`${error.name}: ${error.message}`);
      }
    } finally {
      try {
        await this.hooks.restore();
      } finally {
        clearTimeout(deadline);
        this.replaying = false;
        this.activeRecording = null;
      }
    }
    if (this.cancelled) {
      return "Replay cancelled; original world, profile, input and windows restored.";
    }
    const reproduced = this.replayErrors.some((error) =>
      dump.errors.some(
        (expected) => error.split("\n")[0] === expected.split("\n")[0],
      ),
    );
    if (failure) {
      return `Replay stopped: ${failure.message}. Original state restored. ${reproduced ? "Recorded error reproduced." : "No deterministic success claimed."}`;
    }
    if (!reproduced) {
      return `Original state restored. Error was not reproduced; external timing/resource failures are not deterministic. ${comparison ?? ""}`;
    }
    return `Recorded error reproduced through native handlers. Original state restored. ${comparison ?? ""}`;
  }

  destroy() {
    this.cancel();
    this.controller.abort();
    this.latest = null;
    this.imported = null;
    this.actions.length = 0;
  }
}
