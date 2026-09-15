const CORRECT_MS = 180;
const PREDICT_MS = 600;
const BRAKE_MS = 150;
const SNAP_PX = 256;

/** Display-only dead reckoning in milliseconds; the final 150 ms brakes to a stop. */
export function remoteTravelMs(age) {
  const steady = PREDICT_MS - BRAKE_MS;
  if (age <= steady) return Math.max(0, age);
  const brake = Math.min(BRAKE_MS, age - steady);
  return steady + brake - (brake * brake) / (2 * BRAKE_MS);
}

/** Server XY/velocity remain untouched. One preallocated pose blends each new observation. */
export class RemoteMotion {
  constructor(entity, tick, now, trajectory = null) {
    this.trajectory = trajectory;
    this.x = entity.position.x;
    this.y = entity.position.y;
    this.offsetX = this.offsetY = 0;
    this.tick = -Infinity;
    this.observe(entity, tick, now, null);
  }
  observe(entity, tick, now, foothold) {
    if (tick <= this.tick) return;
    if (this.entity) this.sample(now);
    const reset =
      !this.entity ||
      this.entity.mobState?.generation !== entity.mobState?.generation ||
      Math.hypot(this.x - entity.position.x, this.y - entity.position.y) >
        SNAP_PX;
    this.offsetX = reset ? 0 : this.x - entity.position.x;
    this.offsetY = reset ? 0 : this.y - entity.position.y;
    this.entity = entity;
    this.tick = tick;
    this.received = now;
    this.foothold = foothold;
    this.trajectory?.observe(entity);
    this.sample(now);
  }
  sample(now) {
    const age = Math.max(0, now - this.received);
    const travel = remoteTravelMs(age) / 1000;
    this.project(travel);
    const correction = Math.min(1, age / CORRECT_MS);
    const remaining = 1 - correction * correction * (3 - 2 * correction);
    this.x = this.targetX + this.offsetX * remaining;
    this.y = this.targetY + this.offsetY * remaining;
    return this;
  }
  project(travel) {
    if (this.trajectory?.enabled) {
      const point = this.trajectory.sample(travel);
      this.targetX = point.x;
      this.targetY = point.y;
      return;
    }
    const entity = this.entity;
    const moving = entity.mobState?.hp !== 0;
    let x = entity.position.x + (moving ? entity.velocity.x * travel : 0);
    let y = entity.position.y + (moving ? entity.velocity.y * travel : 0);
    const floor = this.foothold;
    if (floor && floor.x1 !== floor.x2 && entity.mobState?.movementType !== 3) {
      x = Math.max(
        Math.min(floor.x1, floor.x2),
        Math.min(Math.max(floor.x1, floor.x2), x),
      );
      y =
        floor.y1 +
        ((x - floor.x1) * (floor.y2 - floor.y1)) / (floor.x2 - floor.x1);
    }
    this.targetX = x;
    this.targetY = y;
  }
  relocate(x, y, now) {
    this.entity = {
      ...this.entity,
      position: { x, y },
      velocity: { x: 0, y: 0 },
    };
    this.x = x;
    this.y = y;
    this.offsetX = this.offsetY = 0;
    this.received = now;
    // A relocation gives no destination contact or velocity. Hold until a full state arrives.
    this.foothold = null;
    if (this.trajectory) this.trajectory.enabled = false;
  }
}
