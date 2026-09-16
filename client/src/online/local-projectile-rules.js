import { projectileRange, selectAmmunition } from "../combat/weapon-usage.js";
import { SkillResources } from "../skills/skill-resources.js";

/** Original ray range and ball branch; persistent damage and ammunition are never predicted. */
export function projectilePreview(owner, combat, skillUse = {}, use = null) {
  const { id, skill, info, spec } = skillUse;
  const descriptor = ballDescriptor(owner, id, skill);
  if (!use?.ranged && !spec?.projectile && !descriptor) return null;
  const templateId = projectileTemplate(owner, combat, spec, use);
  if (!descriptor && !templateId) return null;
  return {
    descriptor,
    templateId,
    range: previewRange(owner, combat, info, spec),
    ...flightOptions(info, spec),
  };
}

function projectileTemplate(owner, combat, spec, use) {
  return (
    use?.projectileId || (spec?.ammunition ? ammunition(owner, combat) : 0)
  );
}

function flightOptions(info, spec) {
  return {
    start: spec?.kind === "magic" ? 50 : 65,
    count: Math.min(30, Math.max(1, Number(info?.bulletCount ?? 1))),
  };
}

function ballDescriptor(owner, id, skill) {
  if (!skill) return null;
  const rank = owner.store.profile.skills[id]?.level ?? 0;
  const path = SkillResources.prototype.phasePath(skill, "ball", rank);
  const descriptor = path && skill.visuals[path];
  return descriptor?.bundle && descriptor.available !== false
    ? descriptor
    : null;
}

function previewRange(owner, combat, info, spec) {
  if (Number(info?.range)) return Number(info.range);
  if (spec?.kind === "magic" || spec?.kind === "fixed") return 300;
  return weaponRange(owner, combat);
}

function ammunition(owner, combat) {
  const ammo = selectAmmunition(
    owner.store.profile,
    owner.catalog.ui.items,
    combat.weaponId,
  );
  if (ammo) return ammo.id;
  const modifiers = owner.state?.self.entity.combatState?.modifiers;
  if (!modifiers?.soulArrow) return 0;
  return combat.weaponType === 45
    ? 2060000
    : combat.weaponType === 46
      ? 2061000
      : 0;
}

function weaponRange(owner, combat) {
  return projectileRange(combat.weaponType, owner.store.profile.job, {
    skillLevel: (id) => owner.store.profile.skills[id]?.level ?? 0,
    skillInfo: (id, rank) => owner.catalog.ui.skills[id]?.levels[rank],
  });
}

/** The nearest visible forward mob inside the ray, or null for the original empty endpoint. */
export function previewTarget(scene, origin, range) {
  let selected = null,
    distance = range;
  for (const view of scene.views.values()) {
    if (view.entity.kind !== "mob" || !view.entity.mobState.hp) continue;
    const dx = (view.drawX - origin.x) * origin.facing;
    if (dx <= 0 || dx >= distance || Math.abs(view.drawY - origin.y) > 80) {
      continue;
    }
    distance = dx;
    selected = view;
  }
  return selected;
}

/** Aim at the nearest visible forward mob, or the original empty-ray endpoint. */
export function previewDestination(scene, origin, range) {
  const selected = previewTarget(scene, origin, range);
  return selected
    ? { x: selected.drawX, y: selected.drawY - 20 }
    : { x: origin.x + origin.facing * range, y: origin.y - 28 };
}
