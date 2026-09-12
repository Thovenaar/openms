import { PROTOCOL } from "../../../shared/protocol.js";

const CLOCK_SAMPLES = 9;
const MAX_RTT_MS = 2000;
const MAX_SLEW_MS_PER_SECOND = 60;

/** Fixed-size median ring; all scratch allocation precedes observation processing. */
class MedianRing {
  constructor() {
    this.values = new Float64Array(CLOCK_SAMPLES);
    this.scratch = new Float64Array(CLOCK_SAMPLES);
    this.count = 0;
    this.next = 0;
  }

  clear() {
    this.count = 0;
    this.next = 0;
  }

  add(value) {
    this.values[this.next] = value;
    this.next = (this.next + 1) % CLOCK_SAMPLES;
    this.count = Math.min(CLOCK_SAMPLES, this.count + 1);
    for (let index = 0; index < this.count; index++) {
      const current = this.values[index];
      let target = index;
      for (; target > 0 && this.scratch[target - 1] > current; target--) {
        this.scratch[target] = this.scratch[target - 1];
      }
      this.scratch[target] = current;
    }
    return this.scratch[Math.floor(this.count / 2)];
  }
}

function slew(current, target, elapsed) {
  const maximum = (MAX_SLEW_MS_PER_SECOND * Math.max(0, elapsed)) / 1000;
  return current + Math.max(-maximum, Math.min(maximum, target - current));
}

/** Server time is estimated only from authenticated observations, never advanced by rendering. */
export class ServerClock {
  constructor() {
    this.rtts = new MedianRing();
    this.offsets = new MedianRing();
    this.tickOffsets = new MedianRing();
    this.reset();
  }

  reset() {
    this.connectionEpoch = null;
    this.resetField();
    this.roundTripMs = 0;
    this.oneWayMs = 0;
    this.offsetMs = 0;
    this.wallObservedAt = 0;
    this.rtts.clear();
    this.offsets.clear();
  }

  /** Retire field ticks without discarding connection-wide heartbeat latency. */
  resetField() {
    this.fieldEpoch = null;
    this.tickOffsetMs = 0;
    this.serverTick = 0;
    this.receivedAt = 0;
    this.paused = false;
    this.ready = false;
    this.tickOffsets.clear();
  }

  /** sample carries local receive time and optional measured RTT/server wall time. */
  observe(sample) {
    if (
      !Number.isFinite(sample.receivedAt) ||
      !Number.isSafeInteger(sample.serverTick)
    ) {
      throw new Error("Invalid server timing sample");
    }
    if (this.connectionEpoch !== sample.connectionEpoch) this.reset();
    if (
      this.connectionEpoch === sample.connectionEpoch &&
      sample.receivedAt < this.receivedAt
    ) {
      return this.snapshot();
    }
    this.connectionEpoch = sample.connectionEpoch;
    if (sample.roundTripMs !== null && sample.roundTripMs !== undefined) {
      if (
        !Number.isFinite(sample.roundTripMs) ||
        sample.roundTripMs < 0 ||
        sample.roundTripMs > MAX_RTT_MS
      ) {
        throw new Error("Unsupported server round-trip delay");
      }
      this.roundTripMs = this.rtts.add(sample.roundTripMs);
      this.oneWayMs = this.roundTripMs / 2;
    }
    this.observeWall(sample);
    // Heartbeats have no field epoch: their tick cannot authenticate a field clock.
    if (sample.fieldEpoch !== undefined) this.observeTicks(sample);
    return this.snapshot();
  }

  observeWall(sample) {
    if (sample.serverTime === undefined) return;
    const first = this.offsets.count === 0;
    const median = this.offsets.add(
      sample.serverTime - sample.receivedAt + this.oneWayMs,
    );
    this.offsetMs = first
      ? median
      : slew(this.offsetMs, median, sample.receivedAt - this.wallObservedAt);
    this.wallObservedAt = sample.receivedAt;
  }

  observeTicks(sample) {
    if (
      this.fieldEpoch !== sample.fieldEpoch ||
      this.paused !== sample.paused
    ) {
      this.tickOffsets.clear();
    }
    this.fieldEpoch = sample.fieldEpoch;
    this.paused = sample.paused;
    if (this.tickOffsets.count && sample.serverTick < this.serverTick) return;
    const first = this.tickOffsets.count === 0;
    const median = this.tickOffsets.add(
      sample.serverTick * PROTOCOL.TICK_MS - sample.receivedAt + this.oneWayMs,
    );
    this.tickOffsetMs = first
      ? median
      : slew(this.tickOffsetMs, median, sample.receivedAt - this.receivedAt);
    this.serverTick = sample.serverTick;
    this.receivedAt = sample.receivedAt;
    this.ready = true;
  }

  arrivalTick(now) {
    if (!this.ready) return null;
    if (this.paused) return this.serverTick;
    return Math.max(
      this.serverTick,
      Math.floor((now + this.oneWayMs + this.tickOffsetMs) / PROTOCOL.TICK_MS),
    );
  }

  snapshot() {
    return Object.freeze({
      connectionEpoch: this.connectionEpoch,
      fieldEpoch: this.fieldEpoch,
      receivedAt: this.receivedAt,
      serverTick: this.serverTick,
      roundTripMs: this.roundTripMs,
      oneWayMs: this.oneWayMs,
      offsetMs: this.offsetMs,
      tickOffsetMs: this.tickOffsetMs,
      paused: this.paused,
      ready: this.ready,
    });
  }
}
