/** Normal player branch 0094d8f1..0094d9be, not Morph template clamps. */
const MIN_MOVEMENT_STAT = 80;
const SPEED_CAP = 140;
const JUMP_CAP = 123;
const BASE_MOVEMENT_STAT = 100;
const PERCENT = 0.01;

/** Apply cached SkillSystem additive secondary stats before advancing physics.
 * Null restores the unbuffed actor. Rebuild from original globals, never multiply
 * a prior buff: expiry, recast, profile replacement and death cannot compound.
 * Ordinary unmounted players only; equipment/morph/mount composition is separate.
 * @param {object} sim Simulation returned by createSimulation.
 * @param {{speed: number, jump: number}|null} derived Active additive skill stats.
 */
export function updateSkillMovement(sim, derived) {
  const speed = derived === null ? 0 : derived.speed;
  const jump = derived === null ? 0 : derived.jump;
  if (!Number.isSafeInteger(speed) || !Number.isSafeInteger(jump)) {
    throw new Error("Invalid skill movement secondary stats");
  }
  const speedScale =
    Math.min(
      SPEED_CAP,
      Math.max(MIN_MOVEMENT_STAT, BASE_MOVEMENT_STAT + speed),
    ) * PERCENT;
  const jumpScale =
    Math.min(JUMP_CAP, Math.max(MIN_MOVEMENT_STAT, BASE_MOVEMENT_STAT + jump)) *
    PERCENT;
  const settings = sim.effectiveSettings;
  settings.walkSpeed = settings.baseWalkSpeed * speedScale;
  settings.jumpSpeed = settings.baseJumpSpeed * jumpScale;
  // 0094d975 copies Speed into ability+60; 009b3176 consumes it for swimming.
  settings.swimSpeed = settings.baseSwimSpeed * speedScale;
}
