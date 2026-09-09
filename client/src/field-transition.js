// Ordinary field leave 00776e65 and enter 00776b64: global brightness over 600ms.
// The special context+0x30b0 branch is not an ordinary offline field transition.
const FIELD_FADE_MS = 600;
const FULL_BRIGHTNESS = 255;

/** One deferred boundary per transaction; cancellation resolves false, never rejects. */
function boundary() {
  let settle;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** Presentation-only transaction gate. Main exclusively owns scenes and load cancellation.
 * Advance with visible frame milliseconds, independently of blocked field physics.
 * No timers: paused/seeded callers may explicitly advance the same state machine.
 * Leave is synchronous in 00776e65; enter 00776b64 only schedules brightness vectors.
 * 00529269 does not await its returned deadline: gameplay resumes during reveal.
 * Restoring the last-good field on asynchronous failure is explicit browser policy.
 */
export class FieldTransition {
  constructor() {
    this.active = null;
    this.phase = "idle";
    this.brightness = FULL_BRIGHTNESS;
    this.elapsedMs = 0;
    this.startBrightness = FULL_BRIGHTNESS;
    this.durationMs = 0;
    this.lastOutcome = "idle";
  }

  /** Positive application generation ID, not a portal/server authorization token.
   * Returned promises resolve true at opaque/visible boundaries or false on cancellation.
   * Replacement is bounded to one transaction; stale callers cannot reveal a successor.
   */
  begin(id) {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error("Field transition requires a positive generation ID");
    }
    if (this.active?.id === id) {
      throw new Error("Field transition generation already active");
    }
    this.cancel();
    const covered = boundary();
    const finished = boundary();
    this.active = { id, covered, finished };
    this.phase = "leaving";
    this.elapsedMs = 0;
    this.startBrightness = FULL_BRIGHTNESS;
    this.durationMs = FIELD_FADE_MS;
    this.lastOutcome = "pending";
    return { id, covered: covered.promise, finished: finished.promise };
  }

  owns(id) {
    return this.active !== null && this.active.id === id;
  }

  get blocksInput() {
    return this.phase === "leaving" || this.phase === "covered";
  }

  /** Render a black screen-space overlay above field and HUD, without changing scene alpha. */
  get opacity() {
    return 1 - this.brightness / FULL_BRIGHTNESS;
  }

  /** Commit only after covered resolves true, then release input and reveal the live field. */
  reveal(id) {
    if (!this.owns(id)) return false;
    if (this.phase !== "covered") {
      throw new Error("Field replacement must commit while fully covered");
    }
    this.startReveal("committed");
    return true;
  }

  /** Failed loading leaves Main's scene untouched and reverses the current darkness.
   * Restoring at the same brightness rate avoids a flash after partial fade-out.
   */
  fail(id) {
    if (!this.owns(id)) return false;
    if (this.phase === "entering") return false;
    this.active.covered.settle(false);
    this.startReveal("failed");
    return true;
  }

  startReveal(outcome) {
    this.phase = "entering";
    this.elapsedMs = 0;
    this.startBrightness = this.brightness;
    this.durationMs =
      ((FULL_BRIGHTNESS - this.brightness) * FIELD_FADE_MS) / FULL_BRIGHTNESS;
    this.lastOutcome = outcome;
    if (this.durationMs === 0) this.finish();
  }

  /** Finite nonnegative visible-frame milliseconds; each call advances one bounded phase.
   * Excess leave time cannot consume reveal time before the asynchronous commit boundary.
   */
  update(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("Invalid field transition elapsed milliseconds");
    }
    if (this.phase !== "leaving" && this.phase !== "entering") return;
    this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + ms);
    const fraction = this.elapsedMs / this.durationMs;
    if (this.phase === "leaving") {
      this.brightness = Math.trunc(FULL_BRIGHTNESS * (1 - fraction));
      if (this.elapsedMs === this.durationMs) {
        this.phase = "covered";
        this.active.covered.settle(true);
      }
      return;
    }
    this.brightness = Math.trunc(
      this.startBrightness +
        (FULL_BRIGHTNESS - this.startBrightness) * fraction,
    );
    if (this.elapsedMs === this.durationMs) this.finish();
  }

  finish() {
    const active = this.active;
    this.active = null;
    this.phase = "idle";
    this.brightness = FULL_BRIGHTNESS;
    this.elapsedMs = 0;
    this.durationMs = 0;
    active.finished.settle(true);
  }

  /** Superseding direct developer loads and teardown remove the overlay immediately. */
  cancel(id = this.active?.id) {
    if (!this.owns(id)) return false;
    const active = this.active;
    this.active = null;
    this.phase = "idle";
    this.brightness = FULL_BRIGHTNESS;
    this.elapsedMs = 0;
    this.durationMs = 0;
    this.lastOutcome = "cancelled";
    active.covered.settle(false);
    active.finished.settle(false);
    return true;
  }

  /** Allocate only for explicit inspection, never in the frame loop. */
  snapshot() {
    return {
      phase: this.phase,
      generation: this.active?.id ?? null,
      brightness: this.brightness,
      opacity: this.opacity,
      blocksInput: this.blocksInput,
      elapsedMs: this.elapsedMs,
      durationMs: this.durationMs,
      lastOutcome: this.lastOutcome,
    };
  }
}
