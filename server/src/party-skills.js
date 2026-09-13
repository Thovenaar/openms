import { protocolError } from "../../shared/schema.js";
import { skillBuffSpecification } from "../../client/src/skills/skill-state-controller.js";
import { MAX_TEMPORARY_STATS } from "../../client/src/skills/temporary-stats.js";
import { recalculateVitals } from "../../client/src/character/character-stats.js";

const MAX_FIELD_ACTORS = 128;
const UTILITY = new Map([
  [2301002, "heal"],
  [2311001, "dispel"],
  [2321006, "resurrection"],
  [5121010, "time-leap"],
]);
const FIELD_BUFFS = new Set([1005, 10001005, 20001005]);
const CURABLE = new Set([120, 121, 122, 124, 125, 126]);

/** OpenMS policy: authored area buffs affect a real party; weapon charges remain personal. */
export function partySkillKind(skill, info) {
  if (UTILITY.has(skill.id)) return UTILITY.get(skill.id);
  if (skill.classification.owner !== "state" || !info.lt || !info.rb) {
    return null;
  }
  return skill.classification.hooks.includes("charge") ? null : "buff";
}

function inside(actor, target, info) {
  if (actor === target) return true;
  const { lt, rb } = info;
  if (!lt || !rb || ![lt.x, lt.y, rb.x, rb.y].every(Number.isFinite)) {
    return false;
  }
  const x = target.simulation.x - actor.simulation.x;
  const y = target.simulation.y - actor.simulation.y;
  const left = actor.simulation.facing < 0 ? lt.x : -rb.x;
  const right = actor.simulation.facing < 0 ? rb.x : -lt.x;
  return x >= left && x < right && y >= lt.y && y < rb.y;
}

export function sameParty(actor, target) {
  const party = actor.profile.social.party;
  const other = target.profile.social.party;
  return (
    party &&
    other &&
    party.id === other.id &&
    party.leaderId === other.leaderId &&
    party.members.length === other.members.length &&
    party.members.every((id) => other.members.includes(id)) &&
    party.members.includes(target.id) &&
    other.members.includes(actor.id)
  );
}

function eligible(actor, target, skill, info) {
  if (
    target.state !== "active" ||
    target.retiring ||
    target.deliveryError ||
    !target.skills
  ) {
    return false;
  }
  if (target.field !== actor.field || !inside(actor, target, info)) {
    return false;
  }
  if (
    target !== actor &&
    !FIELD_BUFFS.has(skill.id) &&
    !sameParty(actor, target)
  ) {
    return false;
  }
  return partySkillKind(skill, info) === "resurrection"
    ? target !== actor && target.profile.hp === 0
    : target.profile.hp > 0;
}

/** Resolve only live authoritative actors; never turn saved roster rows into targets. */
export function partySkillTargets(world, actor, skill, info) {
  if (!partySkillKind(skill, info)) return [];
  if (actor.field.characters.size > MAX_FIELD_ACTORS) {
    throw protocolError("SERVER_BUSY");
  }
  const targets = [];
  for (const target of actor.field.characters.values()) {
    if (
      world.actors.get(target.id) === target &&
      eligible(actor, target, skill, info)
    ) {
      targets.push(target);
    }
  }
  return targets;
}

export function partySkillError(world, actor, skill, info) {
  const kind = partySkillKind(skill, info);
  if (!kind || kind === "buff" || kind === "heal") return undefined;
  const targets = partySkillTargets(world, actor, skill, info);
  if (kind === "resurrection") {
    return targets.length ? null : "There is no dead party member in range";
  }
  if (kind === "time-leap") {
    return targets.some((target) =>
      [...target.skills.states].some(
        ([id, state]) => id !== skill.id && state.cooldown > 0,
      ),
    )
      ? null
      : "There is no eligible cooldown in range";
  }
  if (targets.some((target) => target.skillField.hasCurableDebuff())) {
    return null;
  }
  return actor.skillField.skillDispelError(info);
}

function installBuff(profile, { caster, skill, info, now }) {
  const { family, values } = skillBuffSpecification(skill, info);
  const effects = profile.onlineState.effects;
  for (let index = effects.length - 1; index >= 0; index--) {
    const effect = effects[index];
    if (
      effect.templateId === skill.id ||
      (family !== "derived-stats" && effect.buffFamily === family)
    ) {
      effects.splice(index, 1);
    }
  }
  if (effects.length >= MAX_TEMPORARY_STATS) throw protocolError("SERVER_BUSY");
  const duration = info.time * 1000;
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw protocolError("CONTENT_MISMATCH");
  }
  effects.push({
    id: crypto.randomUUID(),
    kind: "skill",
    templateId: skill.id,
    rank: caster.skills.level(skill.id),
    cancelable: true,
    duration,
    expiresAt: now + duration,
    spec: values,
    sourceActorId: caster.id,
    buffFamily: family,
  });
}

/** One resource debit and one multi-owner receipt; no target mutations after commitment. */
export function applyPartySkill(world, actor, plan, drafts) {
  const { skill, info, targets } = plan;
  const kind = partySkillKind(skill, info);
  const current = partySkillTargets(world, actor, skill, info);
  if (
    current.length !== targets.length ||
    current.some((target) => !targets.includes(target))
  ) {
    throw protocolError("STALE_FIELD");
  }
  const result = [];
  for (const target of targets) {
    if (
      target.skills.effects.reservation ||
      (target !== actor &&
        (target.skillTask || target.skillField.hasPendingIncoming))
    ) {
      throw protocolError("SERVER_BUSY");
    }
    const profile = drafts.get(target.id);
    if (!profile) throw protocolError("STALE_REVISION");
    const hp = profile.hp;
    applyTarget(
      world,
      actor,
      { skill, info, kind, count: targets.length },
      profile,
    );
    result.push({ actorId: target.id, hp: profile.hp - hp });
  }
  return result;
}

function applyUtility(profile, skillId, kind) {
  const state = profile.onlineState;
  if (kind === "resurrection") profile.hp = profile.maxHP;
  if (kind === "time-leap") {
    for (const key of Object.keys(state.cooldowns)) {
      if (key.startsWith("skill:") && key !== `skill:${skillId}`) {
        delete state.cooldowns[key];
      }
    }
  }
  if (kind === "dispel") {
    state.diseases = (state.diseases ?? []).filter(
      (row) => !CURABLE.has(row.id),
    );
  }
}

function applyTarget(world, actor, { skill, info, kind, count }, profile) {
  if (kind === "buff") {
    installBuff(profile, { caster: actor, skill, info, now: world.now });
  } else if (kind === "heal") {
    // OpenMS distributes the authored caster-HP recovery pool evenly across eligible actors.
    const amount = Math.trunc((actor.profile.maxHP * info.hp) / (100 * count));
    profile.hp = Math.min(profile.maxHP, profile.hp + amount);
  } else if (
    kind !== "dispel" ||
    world.random() * 100 < Number(info.prop ?? 100)
  ) {
    applyUtility(profile, skill.id, kind);
  }
  if (kind === "resurrection") {
    recalculateVitals(profile, world.content.items);
  }
}
