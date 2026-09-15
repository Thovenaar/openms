import {
  DROP_MOTION,
  stepDropFlight,
  hoverDrop,
  dropDrawY,
  dropRotation,
  fadeDisappearingDrop,
} from "../world/drop-motion.js";

const QUANTUM = DROP_MOTION.quantumMs;
const CORRECT_MS = 180;
const FIELDS = [
  "state",
  "age",
  "phaseAge",
  "sourceX",
  "sourceY",
  "groundX",
  "groundY",
  "durationMs",
  "launchSpeed",
  "rotation",
  "alpha",
];

function phaseDuration(slot) {
  if (slot.state === "waiting") return QUANTUM;
  if (slot.state === "launching") {
    return Math.ceil(slot.durationMs / QUANTUM) * QUANTUM;
  }
  if (slot.state === "falling") {
    return (
      Math.ceil(
        ((slot.groundY - slot.sourceY) * 1000) / slot.launchSpeed / QUANTUM,
      ) * QUANTUM
    );
  }
  return Infinity;
}

/** Jump between at most four known phases; no catch-up loop proportional to network age. */
export function projectDrop(slot, entity, elapsed) {
  for (const key of FIELDS) slot[key] = entity.dropMotion[key];
  slot.x = entity.position.x;
  slot.y = entity.position.y;
  slot.itemId = entity.templateId;
  for (let transitions = 0; transitions < 4 && elapsed > 0; transitions++) {
    const remaining = Math.max(0, phaseDuration(slot) - slot.phaseAge);
    const step = Math.min(elapsed, remaining);
    slot.phaseAge += step;
    slot.age += step;
    elapsed -= step;
    if (slot.state === "waiting") {
      if (step === remaining) {
        slot.state = "launching";
        slot.phaseAge = 0;
      }
    } else if (slot.state === "grounded") hoverDrop(slot);
    else stepDropFlight(slot);
    if (elapsed === 0) break;
  }
  slot.visible = slot.state !== "waiting";
  if (entity.dropInfo.disappearing && fadeDisappearingDrop(slot)) {
    slot.visible = false;
  }
  return slot;
}

/** A server-published source/landing plan owns a disposable, monotonic local visual clock. */
export class DropPresentationMotion {
  constructor(entity, tick, now) {
    this.lower = {};
    this.upper = {};
    this.x = entity.position.x;
    this.y = entity.position.y;
    this.offsetX = this.offsetY = 0;
    this.tick = -Infinity;
    this.observe(entity, tick, now);
  }
  observe(entity, tick, now) {
    if (tick <= this.tick) return;
    if (this.entity) this.sample(now);
    const priorX = this.x,
      priorY = this.y;
    this.anchorAge = Math.max(this.age ?? 0, entity.dropMotion.age);
    this.entity = entity;
    this.tick = tick;
    this.received = now;
    this.offsetX = this.offsetY = 0;
    this.sample(now);
    this.offsetX = priorX - this.x;
    this.offsetY = priorY - this.y;
    this.sample(now);
  }
  sample(now) {
    const elapsed = Math.max(0, now - this.received);
    this.age = this.anchorAge + elapsed;
    const since = Math.max(0, this.age - this.entity.dropMotion.age);
    const whole = Math.floor(since / QUANTUM) * QUANTUM;
    this.fraction = (since - whole) / QUANTUM;
    projectDrop(this.lower, this.entity, whole);
    projectDrop(this.upper, this.entity, whole + QUANTUM);
    const t = Math.min(1, elapsed / CORRECT_MS);
    this.remaining = 1 - t * t * (3 - 2 * t);
    this.x =
      this.lower.x +
      (this.upper.x - this.lower.x) * this.fraction +
      this.offsetX * this.remaining;
    this.y =
      this.lower.y +
      (this.upper.y - this.lower.y) * this.fraction +
      this.offsetY * this.remaining;
    this.rotation = dropRotation(
      this.lower,
      since - whole,
      this.entity.templateId !== 0,
    );
    this.alpha =
      this.lower.alpha + (this.upper.alpha - this.lower.alpha) * this.fraction;
    this.visible = this.lower.visible;
    return this;
  }
  renderY(halfHeight) {
    const first = dropDrawY(this.lower, halfHeight);
    return (
      first +
      (dropDrawY(this.upper, halfHeight) - first) * this.fraction +
      this.offsetY * this.remaining
    );
  }
}
