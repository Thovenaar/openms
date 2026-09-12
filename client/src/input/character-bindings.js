import { setSimulationSeat } from "../physics/simulation.js";

// Original expression table0045e8c0; type6 binding ID minus99 at0094f2ed.
export const EXPRESSION_NAMES = Object.freeze([
  "blink",
  "hit",
  "smile",
  "troubled",
  "cry",
  "angry",
  "bewildered",
  "stunned",
  "vomit",
  "oops",
  "cheers",
  "chu",
  "wink",
  "pain",
  "glitter",
  "blaze",
  "shine",
  "love",
  "despair",
  "hum",
  "bowing",
  "hot",
  "dam",
]);
const MAX_SEATS = 4096;
const EMOTION_INTERVAL_MS = 2000; // 00a24470: elapsed >1999.
const SEAT_INTERVAL_MS = 200; // 0094e45f ->00485bf7(200,0).

/** Validate authored map seats once, preserving native array order. */
function readSeats(source = {}) {
  const entries = Object.entries(source);
  if (entries.length > MAX_SEATS) throw new Error("Map seat bound exceeded");
  return entries.map(([key, point]) => {
    const id = Number(key);
    if (
      !/^\d+$/.test(key) ||
      !Number.isSafeInteger(id) ||
      !Number.isSafeInteger(point?.x) ||
      !Number.isSafeInteger(point?.y)
    ) {
      throw new Error("Invalid original map seat");
    }
    return Object.freeze({ id, x: point.x, y: point.y });
  });
}

/** Ephemeral local character actions; inventory ownership stays in the profile. */
export class CharacterBindings {
  constructor(scene, store, gameplay, hooks) {
    for (const name of ["now", "report", "isBlocked"]) {
      if (typeof hooks?.[name] !== "function") {
        throw new Error(`Missing character action hook: ${name}`);
      }
    }
    this.scene = scene;
    this.store = store;
    this.gameplay = gameplay;
    this.hooks = hooks;
    this.seats = readSeats(scene.manifest.physics.map.$seats);
    this.lastEmotionAt = -Infinity;
    this.lastSeatAt = -Infinity;
    this.lastResult = null;
  }

  available() {
    return (
      this.gameplay.prepared &&
      !this.gameplay.dead &&
      !this.gameplay.destroyed &&
      !this.hooks.isBlocked()
    );
  }

  reject(reason) {
    this.lastResult = { ok: false, reason };
    this.hooks.report(reason);
    return false;
  }

  /** Native basic/cash emotion admission; no item is consumed. */
  emote(index) {
    if (!this.available()) return this.reject("Character action is blocked.");
    const name = EXPRESSION_NAMES[index];
    if (!name || !this.scene.actor.expressions.has(name)) {
      return this.reject("The original facial animation is not available.");
    }
    const now = this.hooks.now();
    if (now - this.lastEmotionAt < EMOTION_INTERVAL_MS) {
      return this.reject("Wait two seconds before changing expression again.");
    }
    const duration = this.scene.actor.expressionDurations.get(name);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Original expression lifetime is missing");
    }
    this.scene.actor.setExpression(name, duration);
    this.lastEmotionAt = now;
    this.lastResult = { ok: true, action: "expression", name, duration };
    return true;
  }

  /** 0094f2ed type3: owned cash516 item selects itemID%100+8. */
  useCashExpression(id) {
    const owned = this.store.profile.inventory.some(
      (entry) => entry.id === id && entry.count > 0,
    );
    if (Math.floor(id / 10000) !== 516 || !owned) {
      return this.reject("This cash expression item is not owned.");
    }
    return this.emote((id % 100) + 8);
  }

  /** 00536517: first authored seat in the half-open x±10/y±30 rectangle. */
  sit() {
    if (!this.available()) return this.reject("Sitting is blocked.");
    const now = this.hooks.now();
    if (now - this.lastSeatAt < SEAT_INTERVAL_MS) {
      return this.reject("Wait before changing seats again.");
    }
    const sim = this.scene.simulation;
    if (sim.seat) {
      setSimulationSeat(sim, null);
      this.lastSeatAt = now;
      this.lastResult = { ok: true, action: "stand" };
      return true;
    }
    if (
      this.gameplay.phase !== "idle" ||
      sim.state !== "ground" ||
      sim.vx !== 0 ||
      sim.vy !== 0 ||
      this.gameplay.alertTimerMs > 0
    ) {
      return this.reject("Stand still on the ground before sitting.");
    }
    const seat = this.reachableSeat(sim);
    if (!seat) {
      return this.reject("There is no original map seat within reach.");
    }
    setSimulationSeat(sim, seat);
    this.lastSeatAt = now;
    this.lastResult = { ok: true, action: "sit", seatId: seat.id };
    return true;
  }

  reachableSeat(sim) {
    for (const seat of this.seats) {
      if (
        seat.x >= sim.x - 10 &&
        seat.x < sim.x + 10 &&
        seat.y >= sim.y - 30 &&
        seat.y < sim.y + 30
      ) {
        return seat;
      }
    }
    return null;
  }

  /** Movement leaves the physical seat before the next physics quantum. */
  beforePhysics(input) {
    if (!this.scene.simulation.seat) return;
    if (
      input.left ||
      input.right ||
      input.up ||
      input.down ||
      input.jump ||
      input.attack ||
      this.gameplay.dead ||
      this.gameplay.phase !== "idle"
    ) {
      setSimulationSeat(this.scene.simulation, null);
    }
  }

  inherit(previous) {
    if (!previous || previous === this || previous.store !== this.store) return;
    this.lastEmotionAt = previous.lastEmotionAt;
    this.lastSeatAt = previous.lastSeatAt;
  }

  snapshot() {
    return { seat: this.scene.simulation.seat, lastResult: this.lastResult };
  }
}
