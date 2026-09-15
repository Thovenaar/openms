/** Pure authored action selection shared by admission and local presentation. */
export function skillAttackAction(skill, info, spec, combat) {
  if (spec.kind === "proc") return combat?.defaultAction;
  if (typeof info.action === "string") return info.action;
  if (skill.actions.length) return skill.actions[0];
  if (spec.kind === "magic" || spec.magic || spec.kind === "heal") {
    return "swingO1";
  }
  return spec.projectile || spec.kind === "ranged"
    ? projectileAction(combat)
    : (combat?.defaultAction ?? null);
}

function projectileAction(combat) {
  if (!combat) return null;
  if (combat.weaponType === 45) return "shoot1";
  if (combat.weaponType === 46) return "shoot2";
  if (combat.weaponType === 49) return "shot";
  if (combat.weaponType === 47) return "swingO1";
  return combat.defaultAction ?? null;
}
