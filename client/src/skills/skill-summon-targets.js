const BOTH_SIDES = new Set([2121005, 2221005, 2321003, 12111004]);

export function summonInRange(record, target, facing = record.facing) {
  const range = record.attack?.range;
  if (!range) return false;
  const dx = (target.x - record.x) * -facing - (range.sp?.x ?? 0);
  const dy = target.y - record.y - (range.sp?.y ?? 0);
  if (range.r !== undefined) return dx * dx + dy * dy <= range.r * range.r;
  return insideRectangle(range, dx, dy);
}

function insideRectangle(range, dx, dy) {
  return (
    range.lt &&
    range.rb &&
    dx >= range.lt.x &&
    dx <= range.rb.x &&
    dy >= range.lt.y &&
    dy <= range.rb.y
  );
}

/**007a4d42 chooses the fuller mirrored rectangle;00678ecc selects nearest of ten. */
export function selectSummonTarget(record, mobs, caster) {
  if (BOTH_SIDES.has(record.skill.id)) {
    return rectangularTarget(record, mobs, caster);
  }
  const origin = record.movement === "stationary" ? record : caster;
  let nearest = null,
    distance = Infinity,
    count = 0;
  for (const mob of mobs) {
    if (!nearbyTarget(mob, origin)) continue;
    if (++count > 10) break;
    const squared = (mob.x - origin.x) ** 2 + (mob.y - origin.y) ** 2;
    if (squared < distance) {
      nearest = mob;
      distance = squared;
    }
  }
  if (!nearest) return null;
  return summonInRange(record, nearest, nearest.x >= record.x ? 1 : -1)
    ? nearest
    : null;
}

function nearbyTarget(mob, origin) {
  return !(
    !mob.alive ||
    !mob.active ||
    Math.abs(mob.x - origin.x) > 300 ||
    Math.abs(mob.y - origin.y) > 100
  );
}

function rectangularTarget(record, mobs, caster) {
  let left = null,
    right = null,
    leftCount = 0,
    rightCount = 0;
  const limit = record.attack.mobCount ?? 1;
  for (const mob of mobs) {
    if (!mob.alive || !mob.active) continue;
    if (leftCount < limit && summonInRange(record, mob, -1)) {
      left ??= mob;
      leftCount++;
    }
    if (rightCount < limit && summonInRange(record, mob, 1)) {
      right ??= mob;
      rightCount++;
    }
  }
  return preferRightSide(record, caster, leftCount, rightCount) ? right : left;
}

function preferRightSide(record, caster, leftCount, rightCount) {
  if (leftCount !== rightCount) return rightCount > leftCount;
  let rightward = record.x <= caster.x;
  if (record.skill.id === 2321003) rightward = !rightward;
  return rightward;
}
