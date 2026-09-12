const LOOP = Object.freeze({ loop: true, follow: true });

export function createSummonProjectile() {
  return { x: 0, y: 0, facing: 1, active: false, slot: null, ageMs: 0 };
}

/** Original attack.info range.sp is the projectile emission point; bulletSpeed is pixels/sec. */
export function fireSummonProjectile(system, record) {
  const projectile = record.projectile;
  const point = record.attack.range.sp;
  projectile.x = record.x - record.facing * point.x;
  projectile.y = record.y + point.y;
  projectile.facing = record.facing;
  projectile.active = true;
  projectile.ageMs = 0;
  projectile.slot = system.resources.playSequence(
    record.sequences.get("summon/attack1/info/ball"),
    projectile,
    LOOP,
  );
}

export function stepSummonProjectile(system, record, ms) {
  const projectile = record.projectile;
  if (!projectile.active) return false;
  projectile.ageMs += ms;
  const target = record.target;
  if (!target?.alive || projectile.ageMs > 5000) {
    stopSummonProjectile(system, record);
    return false;
  }
  const x = (target.body.left + target.body.right) / 2;
  const y = (target.body.top + target.body.bottom) / 2;
  const distance = Math.hypot(x - projectile.x, y - projectile.y);
  const travel = (record.attack.bulletSpeed * ms) / 1000;
  if (travel >= distance) {
    stopSummonProjectile(system, record);
    return true;
  }
  projectile.x += ((x - projectile.x) * travel) / distance;
  projectile.y += ((y - projectile.y) * travel) / distance;
  return false;
}

export function stopSummonProjectile(system, record) {
  record.projectile.active = false;
  system.resources.stop(record.projectile.slot);
  record.projectile.slot = null;
}
