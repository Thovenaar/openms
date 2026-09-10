import { itemConditionsMatch } from "./item-conditions.js";

// Native 007b24d5 clears incoming mask bits from older rows and removes empty rows.
// Cosmic Character.registerEffect/config.yaml selects greatest numeric stat values;
// latent source timers survive overlap and become effective again after cancellation.
export const MAX_TEMPORARY_STATS = 64;
export const TEMPORARY_STATS = Object.freeze([
  "pad",
  "pdd",
  "mad",
  "mdd",
  "acc",
  "eva",
  "speed",
  "jump",
  "stance",
  "magicGuard",
  "recovery",
  "mesoupbyitem",
  "itemupbyitem",
]);
// Cosmic BuffStat (original packet low 64 bits). Upper 64 bits are unused by these controllers.
const MASK_LOW = [0, 0, 0, 0, 0, 0, 0, 0, 0x10, 0, 0x4, 0x10000, 0x100000];
const MASK_HIGH = [1, 2, 4, 8, 16, 32, 128, 256, 0, 512, 0, 0, 0];

/** All objects are prepared outside the simulation loop. Sources own timers, not row slots. */
export function temporaryState(kind, id) {
  return {
    kind,
    id,
    source: kind === "item" ? -id : id,
    rank: 0,
    cooldown: 0,
    remaining: 0,
    totalMs: 0,
    segmentMs: 0,
    recoveryElapsed: 0,
    expiresAt: null,
    noShadow: false,
    conditions: null,
    unavailable: null,
    itemValues: null,
    maskLow: 0,
    maskHigh: 0,
    statCount: 0,
    previousMaskLow: 0,
    previousMaskHigh: 0,
    values: new Float64Array(TEMPORARY_STATS.length),
  };
}

/** 007b4511..33: signed quotient after integer total/16, then clamp, not a ratio. */
export function durationFrame(state) {
  if (state.noShadow) return -1;
  return Math.max(
    0,
    Math.min(15, Math.trunc(state.remaining / state.segmentMs)),
  );
}

export function configureTemporaryState(
  state,
  spec,
  duration,
  noShadow = false,
) {
  state.totalMs = duration;
  state.segmentMs = Math.trunc(duration / 16);
  state.noShadow = Boolean(noShadow);
  state.statCount = 0;
  for (let index = 0; index < TEMPORARY_STATS.length; index++) {
    const field = TEMPORARY_STATS[index];
    const amount = spec[field] ?? 0;
    // Cosmic card packet values are4, NOT prob or the authored itemup selector.
    const value =
      (field === "mesoupbyitem" || field === "itemupbyitem") && amount !== 0
        ? 4
        : amount;
    state.values[index] = value;
    if (value !== 0) state.statCount++;
  }
}

/** Bounded shared authority transferred only between same-store map owners. */
export class TemporaryStats {
  constructor() {
    this.sources = new Array(MAX_TEMPORARY_STATS).fill(null);
    this.visible = new Array(MAX_TEMPORARY_STATS).fill(null);
    this.winners = new Array(TEMPORARY_STATS.length).fill(null);
    this.count = 0;
    this.visibleCount = 0;
    this.revision = 0;
    this.reservation = null;
    this.destroyed = false;
    this.context = { mapId: null, partyHunting: false };
    this.derived = Object.fromEntries(TEMPORARY_STATS.map((key) => [key, 0]));
  }

  find(source) {
    for (let index = 0; index < this.count; index++) {
      if (this.sources[index].source === source) return this.sources[index];
    }
    return null;
  }

  /** Cosmic Character.updateActiveEffects: map/party changes reproject latent timers. */
  refreshConditions(context) {
    if (
      !context ||
      !Number.isInteger(context.mapId) ||
      context.mapId < 0 ||
      context.mapId > 999999999 ||
      typeof context.partyHunting !== "boolean"
    ) {
      throw new Error("Invalid temporary item condition context");
    }
    if (
      this.context.mapId === context.mapId &&
      this.context.partyHunting === context.partyHunting
    ) {
      return;
    }
    this.context.mapId = context.mapId;
    this.context.partyHunting = context.partyHunting;
    this.recompute();
  }

  /** Cosmic Character.getCardRate and StatEffect.getCardRate; no RNG or quantity changes. */
  cardRate(itemId) {
    const state = this.winners[itemId === 0 ? 11 : 12];
    if (!state) return 1;
    const values = state.itemValues;
    if (
      (values.itemupbyitem === 2 && values.itemCode !== itemId) ||
      (values.itemupbyitem === 3 &&
        values.itemRange !== Math.floor(itemId / 10000))
    ) {
      return 1;
    }
    return Math.fround(Math.fround(100 + values.prob) / 100);
  }

  /** A dormant unrecovered source never becomes a silent successful partial effect. */
  unavailableCondition() {
    for (let index = 0; index < this.count; index++) {
      const state = this.sources[index];
      if (
        state.unavailable &&
        itemConditionsMatch(state.conditions, this.context)
      ) {
        return state.unavailable;
      }
    }
    return null;
  }

  canStart(source) {
    return (
      !this.destroyed &&
      !this.reservation &&
      (this.count < MAX_TEMPORARY_STATS || this.find(source) !== null)
    );
  }

  /** Admission guarantees capacity. No callbacks, resource loads or allocations at publication. */
  start(state) {
    this.remove(state.source);
    for (let index = this.count; index > 0; index--) {
      this.sources[index] = this.sources[index - 1];
    }
    this.sources[0] = state;
    this.count++;
    state.remaining = state.totalMs;
    state.recoveryElapsed = 0;
    this.recompute();
  }

  remove(source) {
    for (let index = 0; index < this.count; index++) {
      if (this.sources[index].source !== source) continue;
      this.removeVisible(this.sources[index]);
      this.sources[index].remaining = 0;
      this.sources[index].maskLow = 0;
      this.sources[index].maskHigh = 0;
      for (let next = index + 1; next < this.count; next++) {
        this.sources[next - 1] = this.sources[next];
      }
      this.sources[--this.count] = null;
      return true;
    }
    return false;
  }

  /** Numeric max, then broader source, then newest: Cosmic Character.java4572. */
  recompute() {
    this.winners.fill(null);
    for (let index = 0; index < this.count; index++) {
      const state = this.sources[index];
      state.previousMaskLow = state.maskLow;
      state.previousMaskHigh = state.maskHigh;
      state.maskLow = 0;
      state.maskHigh = 0;
      if (
        state.unavailable ||
        !itemConditionsMatch(state.conditions, this.context)
      ) {
        continue;
      }
      for (let stat = 0; stat < TEMPORARY_STATS.length; stat++) {
        if (state.values[stat] === 0) continue;
        const prior = this.winners[stat];
        if (
          !prior ||
          state.values[stat] > prior.values[stat] ||
          (state.values[stat] === prior.values[stat] &&
            state.statCount > prior.statCount)
        ) {
          this.winners[stat] = state;
        }
      }
    }
    this.project();
  }

  project() {
    for (let stat = 0; stat < TEMPORARY_STATS.length; stat++) {
      const winner = this.winners[stat];
      this.derived[TEMPORARY_STATS[stat]] = winner ? winner.values[stat] : 0;
      if (!winner) continue;
      winner.maskLow |= MASK_LOW[stat];
      winner.maskHigh |= MASK_HIGH[stat];
    }
    // A native mask update preserves partial survivors, removes empty rows and reinserts
    // newly published/restored sources. Source timer order and row insertion are separate.
    for (let index = this.visibleCount - 1; index >= 0; index--) {
      const state = this.visible[index];
      if (!state.maskLow && !state.maskHigh) this.removeVisible(state);
    }
    for (let index = this.count - 1; index >= 0; index--) {
      const state = this.sources[index];
      const gained =
        (state.maskLow & ~state.previousMaskLow) |
        (state.maskHigh & ~state.previousMaskHigh);
      if (!gained) continue;
      this.removeVisible(state);
      for (let slot = this.visibleCount; slot > 0; slot--) {
        this.visible[slot] = this.visible[slot - 1];
      }
      this.visible[0] = state;
      this.visibleCount++;
    }
    this.revision++;
  }

  removeVisible(state) {
    for (let index = 0; index < this.visibleCount; index++) {
      if (this.visible[index] !== state) continue;
      for (let next = index + 1; next < this.visibleCount; next++) {
        this.visible[next - 1] = this.visible[next];
      }
      this.visible[--this.visibleCount] = null;
      return;
    }
  }

  reserve(state) {
    if (!this.canStart(state.source)) {
      throw new Error("Temporary stat authority is busy or full");
    }
    const prepared = { authority: this, state, published: false };
    this.reservation = prepared;
    return prepared;
  }

  /** Only a successfully committed item operation may publish its own reservation. */
  publish(prepared) {
    if (this.reservation !== prepared) return;
    this.reservation = null;
    this.start(prepared.state);
    prepared.published = true;
  }

  abort(prepared) {
    if (this.reservation === prepared) this.reservation = null;
  }

  clear() {
    this.reservation = null;
    for (let index = 0; index < this.count; index++) {
      this.sources[index].remaining = 0;
      this.sources[index].maskLow = 0;
      this.sources[index].maskHigh = 0;
      this.sources[index] = null;
    }
    this.count = 0;
    this.visible.fill(null);
    this.visibleCount = 0;
    this.recompute();
  }
}
