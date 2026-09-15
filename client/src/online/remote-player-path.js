import { crossingFraction, MAX_TRANSITIONS } from "../physics/geometry.js";

const STEP_MS = 30;
const SAMPLES = 21;
const SECONDS = STEP_MS / 1000;

/** Bounded display forecast from received velocity/mode; never executes peer input or combat. */
export class RemotePlayerPath {
  constructor(geometry) {
    this.geometry = geometry;
    this.points = Array.from({ length: SAMPLES }, () => ({ x: 0, y: 0 }));
    this.candidates = [];
    this.position = { x: 0, y: 0 };
    this.enabled = false;
  }
  observe(entity) {
    this.enabled = Boolean(entity.playerMotion);
    if (!this.enabled) return;
    this.hint = entity.playerMotion;
    this.state = this.hint.state;
    this.x = entity.position.x;
    this.y = entity.position.y;
    this.vx = entity.velocity.x;
    this.vy = entity.velocity.y;
    this.floor =
      this.state === "ground" ? this.geometry.byId.get(entity.foothold) : null;
    if (entity.seat || entity.combatState?.phase === "dead") {
      this.vx = this.vy = 0;
    }
    this.stationary = Boolean(
      entity.seat || entity.combatState?.phase === "dead",
    );
    this.fault = null;
    this.prepareCandidates();
    for (let index = 0; index < SAMPLES; index++) {
      this.points[index].x = this.x;
      this.points[index].y = this.y;
      if (index < SAMPLES - 1 && !this.stationary) this.step();
    }
  }
  prepareCandidates() {
    this.candidates.length = 0;
    const reach = Math.hypot(this.vx, this.vy) * 0.6 + 1;
    for (const floor of this.geometry.segments) {
      if (
        floor.x2 >= this.x - reach &&
        floor.x1 <= this.x + reach &&
        floor.tx > 0
      ) {
        this.candidates.push(floor);
      }
    }
  }
  step() {
    this.previousX = this.x;
    this.previousY = this.y;
    if (this.floor) this.ground();
    else if (this.state === "air") this.air();
    else this.linear();
    const bounds = this.geometry.bounds;
    this.x = Math.max(bounds.left, Math.min(bounds.right, this.x));
    this.y = Math.max(bounds.top, Math.min(bounds.bottom, this.y));
  }
  ground() {
    const speed = this.vx * this.floor.tx + this.vy * this.floor.ty;
    let position =
      (this.x - this.floor.x1) * this.floor.tx +
      (this.y - this.floor.y1) * this.floor.ty;
    position += speed * SECONDS;
    for (let count = 0; count < MAX_TRANSITIONS; count++) {
      const floor = this.floor;
      if (position >= 0 && position <= floor.length) {
        this.x = floor.x1 + floor.tx * position;
        this.y = floor.y1 + floor.ty * position;
        this.vx = floor.tx * speed;
        this.vy = floor.ty * speed;
        return;
      }
      const before = position < 0,
        next = before ? floor.prev : floor.next;
      if (!next || next.tx <= 0) {
        this.x = before ? floor.x1 : floor.x2;
        this.y = before ? floor.y1 : floor.y2;
        if (next) this.vx = this.vy = 0;
        else {
          this.floor = null;
          this.state = "air";
        }
        return;
      }
      position = before ? next.length + position : position - floor.length;
      this.floor = next;
    }
    this.fault = "remote-foothold-transition-limit";
    this.vx = this.vy = 0;
  }
  air() {
    const oldVy = this.vy;
    this.vy = Math.min(
      this.hint.fallSpeed,
      this.vy + this.hint.gravity * SECONDS,
    );
    this.x += this.vx * SECONDS;
    this.y += ((oldVy + this.vy) * SECONDS) / 2;
    let nearest = 2,
      selected = null;
    for (const floor of this.candidates) {
      if (floor.id === this.hint.ignoredFoothold) continue;
      const fraction = crossingFraction(this, floor);
      if (fraction >= 0 && fraction < nearest) {
        nearest = fraction;
        selected = floor;
      }
    }
    if (!selected) return;
    this.x = this.previousX + (this.x - this.previousX) * nearest;
    this.y = selected.y1 + ((this.x - selected.x1) * selected.dy) / selected.dx;
    this.floor = selected;
    this.state = "ground";
    this.vy = (this.vx * selected.ty) / selected.tx;
  }
  linear() {
    this.x += this.vx * SECONDS;
    this.y += this.vy * SECONDS;
    if (this.state === "ladder" && this.hint.ladder) {
      this.x = this.hint.ladder.x;
      this.y = Math.max(
        this.hint.ladder.top,
        Math.min(this.hint.ladder.bottom, this.y),
      );
    }
  }
  sample(seconds) {
    const cursor = Math.min(SAMPLES - 1, (seconds * 1000) / STEP_MS);
    const index = Math.min(SAMPLES - 2, Math.floor(cursor)),
      t = cursor - index;
    const before = this.points[index],
      after = this.points[index + 1];
    this.position.x = before.x + (after.x - before.x) * t;
    this.position.y = before.y + (after.y - before.y) * t;
    return this.position;
  }
}
