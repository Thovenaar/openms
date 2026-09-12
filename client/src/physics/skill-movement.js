/** Normal player branch 0094d8f1..0094d9be, not Morph template clamps. */
const MIN_MOVEMENT_STAT = 80;
const SPEED_CAP = 140;
const JUMP_CAP = 123;
const BASE_MOVEMENT_STAT = 100;
const PERCENT = 0.01;
// Validated offline profile bound; native shoe instance flag2 selects scalar00af82a0.
const MAX_EQUIPPED_ITEMS = 128;
const ANTI_SLIP_FLAG = 0x02;
const ANTI_SLIP_FRICTION = 10;

/** Apply cached SkillSystem additive secondary stats before advancing physics.
 * Null restores the unbuffed actor. Rebuild from original globals, never multiply
 * a prior buff: expiry, recast, profile replacement and death cannot compound.
 * Footwear coefficients and active form templates are independently retained.
 * @param {object} sim Simulation returned by createSimulation.
 * @param {{speed: number, jump: number}|null} derived Active additive skill stats.
 */
export function updateSkillMovement(sim, derived) {
  const speed =
    derived === null
      ? 0
      : derived.speed +
        (derived.darkSightSpeed ?? 0) +
        (derived.dashSpeed ?? 0);
  const jump = derived === null ? 0 : derived.jump + (derived.dashJump ?? 0);
  if (!Number.isSafeInteger(speed) || !Number.isSafeInteger(jump)) {
    throw new Error("Invalid skill movement secondary stats");
  }
  applyMovementStats(sim, speed, jump);
}

function movementScale(base, bonus, cap) {
  return (
    Math.min(
      cap,
      Math.max(MIN_MOVEMENT_STAT, (base ?? BASE_MOVEMENT_STAT) + bonus),
    ) * PERCENT
  );
}

/** Rebuild movement coefficients from base globals and the active form. */
function applyMovementStats(sim, speed, jump) {
  if (sim.fieldLimit & 2) {
    restoreFieldMovement(sim.effectiveSettings);
    return;
  }
  const form = sim.worldMovement?.form;
  const speedScale = movementScale(
    form?.speed,
    speed,
    form?.riding ? 190 : SPEED_CAP,
  );
  const jumpScale = movementScale(form?.jump, jump, JUMP_CAP);
  const settings = sim.effectiveSettings;
  settings.walkSpeed = settings.baseWalkSpeed * speedScale;
  settings.jumpSpeed = settings.baseJumpSpeed * jumpScale;
  // 0094d975 copies Speed into ability+60; 009b3176 consumes it for swimming.
  settings.swimSpeed =
    settings.baseSwimSpeed *
    (form
      ? form.swim * PERCENT
      : speedScale * (sim.worldMovement.equipmentSwim * PERCENT));
  applyFormForces(settings, form, sim.worldMovement.equipmentFs);
}

/** 0094d3d9: forms replace shoe coefficients; ordinary shoes write ability+30/+18. */
function applyFormForces(settings, form, equipmentFs) {
  if (settings.baseForceScale !== undefined) {
    const fs = form?.fs ?? equipmentFs;
    settings.forceScale = settings.baseForceScale * fs;
    settings.friction = settings.baseFriction * fs;
    // 009b2c76..009b2cae: airborne drag reads map+0c, never actor fs.
    settings.drag = settings.baseDrag;
  }
}

/** 0094d311 allocates default004fe802 ability for FieldLimit bit1, preserving sources. */
function restoreFieldMovement(settings) {
  settings.walkSpeed = settings.baseWalkSpeed;
  settings.jumpSpeed = settings.baseJumpSpeed;
  settings.swimSpeed = settings.baseSwimSpeed;
  settings.forceScale = settings.baseForceScale;
  settings.friction = settings.baseFriction;
  settings.drag = settings.baseDrag;
}

function equippedShoe(equipment) {
  if (!Array.isArray(equipment) || equipment.length > MAX_EQUIPPED_ITEMS) {
    throw new Error("Invalid equipped movement input");
  }
  for (const entry of equipment) {
    if (entry.slot === -7) return entry;
  }
  return null;
}

/** Read the real equipped shoe, never its cash appearance. Validated profile input.
 * 005cac3d: template fs defaults1, swim defaults100; 0094da00 consumes that shoe.
 * Main synchronizes this before movement projection after equipment/profile edits. */
export function updateEquipmentMovement(sim, equipment, items) {
  const entry = equippedShoe(equipment);
  let fs = 1;
  let swim = 100;
  if (entry) {
    const info = items[entry.id]?.info;
    if (!info) {
      throw new Error(`Original shoe metadata unavailable: ${entry.id}`);
    }
    fs = entry.flags & ANTI_SLIP_FLAG ? ANTI_SLIP_FRICTION : (info.fs ?? 1);
    swim = info.swim ?? 100;
    if (!Number.isFinite(fs) || fs < 0 || !Number.isSafeInteger(swim)) {
      throw new Error("Invalid original shoe movement properties");
    }
  }
  sim.worldMovement.equipmentFs = fs;
  sim.worldMovement.equipmentSwim = swim;
}
