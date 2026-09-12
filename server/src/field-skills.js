import { randomUUID } from "node:crypto";
import { protocolError } from "../../shared/protocol.js";
import { profileSkillLevel } from "../../client/src/skills/skill-allocation-rules.js";
import { STATE_SKILLS } from "../../client/src/skills/skill-state-rules.js";
import { TELEPORT_SKILLS } from "../../client/src/skills/skill-world-rules.js";
import {
  SkillCosts,
  skillNumber,
} from "../../client/src/skills/skill-costs.js";
import { TEMPORARY_STATS } from "../../client/src/skills/temporary-stats.js";
import {
  teleportDestination,
  commitTeleport,
} from "../../client/src/physics/skill-relocation.js";
import { beginAttack, refreshActorCombat } from "./field-combat.js";
import { rebuildActorEffects } from "./action-character.js";

const PHYSICAL_SKILLS = new Set([1001004, 1001005, 11001002, 11001003]);
const SELF_STATES = new Set([
  "derived-stats",
  "hyper-body",
  "maple-warrior",
  "echo",
  "booster",
  "speed-infusion",
  "invincible",
  "magic-guard",
]);
const SCALARS = new Set([
  "pad",
  "pdd",
  "mad",
  "mdd",
  "acc",
  "eva",
  "speed",
  "jump",
]);

function unavailable(actor, reason) {
  actor.admission = `unsupported-content: ${reason}`;
  throw protocolError("REQUIREMENTS_NOT_MET");
}

function admitSkill(world, actor, action) {
  const skill = world.content.catalog.ui.skills[action.skillId];
  const rank = profileSkillLevel(
    world.content.catalog.ui.skills,
    actor.profile,
    action.skillId,
    world.now,
  );
  const info = skill?.levels[rank];
  if (!skill || !rank || !info || actor.profile.hp <= actor.pendingDamage) {
    throw protocolError("REQUIREMENTS_NOT_MET");
  }
  admitSkillActivation(actor, skill);
  admitSkillPrerequisites(world, actor, skill);
  if (actor.profile.level < (skill.properties.reqLev ?? 0)) {
    throw protocolError("REQUIREMENTS_NOT_MET");
  }
  admitSkillCooldown(world, actor, skill.id);
  refreshActorCombat(world, actor);
  const weapon = skillNumber(
    skill.properties.weapon ?? skill.properties["weapon "],
  );
  if (weapon && actor.stats.weaponType !== weapon) {
    throw protocolError("REQUIREMENTS_NOT_MET");
  }
  return { skill, info, rank };
}

function admitSkillActivation(actor, skill) {
  if (
    !skill.classification.supported ||
    skill.classification.activation === "passive"
  ) {
    unavailable(actor, skill.classification.reason ?? "passive skill");
  }
  if (actor.attackState.active || actor.simulation.state === "ladder") {
    throw protocolError("NOT_ALLOWED");
  }
  if (actor.tradeId || actor.conversation) throw protocolError("NOT_ALLOWED");
}

function admitSkillPrerequisites(world, actor, skill) {
  for (const requirement of skill.prerequisites) {
    if (
      profileSkillLevel(
        world.content.catalog.ui.skills,
        actor.profile,
        requirement.skillId,
        world.now,
      ) < requirement.rank
    ) {
      throw protocolError("REQUIREMENTS_NOT_MET");
    }
  }
}

function admitSkillCooldown(world, actor, id) {
  if (
    world.now < (actor.profile.onlineState?.cooldowns?.[`skill:${id}`] ?? 0)
  ) {
    throw protocolError("COOLDOWN");
  }
  if (world.now < (actor.castUntil ?? 0)) throw protocolError("COOLDOWN");
}

function selfState(actor, skill, info) {
  const spec = STATE_SKILLS.get(skill.id);
  if (!spec || !SELF_STATES.has(spec.family)) return null;
  if (spec.weapons && !spec.weapons.includes(actor.stats.weaponType)) {
    throw protocolError("REQUIREMENTS_NOT_MET");
  }
  const duration = skillNumber(info.time) * 1000;
  if (
    !Number.isSafeInteger(duration) ||
    duration < 16 ||
    duration > 2147483647
  ) {
    throw protocolError("CONTENT_MISMATCH");
  }
  const values = {};
  for (const field of TEMPORARY_STATS) {
    const value = selfStateValue(spec, info, field);
    if (value !== 0) values[field] = value;
  }
  return { values, duration };
}

function selfStateValue(spec, info, field) {
  let value = SCALARS.has(field) ? skillNumber(info[field]) : 0;
  const mapping = spec.fields[field];
  if (mapping !== undefined) {
    value = typeof mapping === "number" ? mapping : skillNumber(info[mapping]);
  }
  if (!Number.isSafeInteger(value)) throw protocolError("CONTENT_MISMATCH");
  return value;
}

function resourceAdapter(world, actor, draft) {
  let dirty = false;
  const system = {
    store: {
      profile: draft,
      profileTransactionPending: false,
      markDirty() {
        dirty = true;
      },
    },
    fullCatalog: world.content.catalog,
    hooks: { items: world.content.items },
    derived() {
      return actor.temporaryStats.derived;
    },
    level(id) {
      return profileSkillLevel(
        world.content.catalog.ui.skills,
        draft,
        id,
        world.now,
      );
    },
    info(id, rank) {
      return world.content.catalog.ui.skills[id]?.levels[rank];
    },
  };
  return {
    costs: new SkillCosts(system),
    changed() {
      return dirty;
    },
  };
}

/** Supported controllers reuse original collision, costs, stat aggregation and damage. */
export async function castSkill(world, actor, action, operation) {
  const plan = admitSkill(world, actor, action);
  prepareSkillCast(actor, action, plan);
  const { buff, teleport, destination, attack, cast, field } = plan;
  const receipt = await world.database.commit(actor, operation, (draft) => {
    admitCastCommit(actor, field);
    return consumeSkillCosts(world, actor, draft, plan);
  });
  if (receipt.status !== "committed") return receipt;
  if (buff) rebuildActorEffects(actor, world);
  actor.castUntil = world.now + cast.duration;
  actor.castAction = cast.action;
  actor.actionStartTick = actor.field.tick;
  if (teleport) commitTeleport(actor.simulation, destination);
  if (attack) beginAttack(world, actor, attack);
  world.publish(actor, { type: "snapshot-request" });
  return receipt;
}

function prepareSkillCast(actor, action, plan) {
  const { skill, info } = plan;
  plan.buff = selfState(actor, skill, info);
  const physical = PHYSICAL_SKILLS.has(skill.id);
  plan.teleport = TELEPORT_SKILLS.has(skill.id);
  if (!plan.buff && !physical && !plan.teleport) {
    unavailable(
      actor,
      `skill ${skill.id} needs its target/form/script controller`,
    );
  }
  if (
    action.target &&
    (action.target.kind !== "entity" || action.target.entityId !== actor.id) &&
    !physical
  ) {
    throw protocolError("NOT_ALLOWED");
  }
  plan.destination = { x: 0, y: 0, foothold: null };
  if (plan.teleport) prepareTeleport(actor, info, plan.destination);
  plan.attack = physical
    ? preparePhysical(actor, skill, info, plan.rank)
    : null;
  plan.cast = prepareCastAction(actor, skill, info);
  plan.field = actor.field;
}

function prepareTeleport(actor, info, destination) {
  const range = skillNumber(info.range);
  if (!Number.isSafeInteger(range) || range <= 0 || range > 1048576) {
    throw protocolError("CONTENT_MISMATCH");
  }
  if (teleportDestination(actor.simulation, range, destination)) {
    throw protocolError("REQUIREMENTS_NOT_MET");
  }
}

function admitCastCommit(actor, field) {
  if (actor.field !== field || actor.profile.hp <= 0) {
    throw protocolError("STALE_FIELD");
  }
  if (
    !actor.session ||
    actor.session.revoked ||
    actor.session.expiresAt <= Date.now()
  ) {
    throw protocolError("SESSION_EXPIRED");
  }
}

function consumeSkillCosts(world, actor, draft, plan) {
  const { skill, info, buff } = plan;
  const adapter = resourceAdapter(world, actor, draft);
  const error = adapter.costs.consume(skill, info);
  if (error) unavailable(actor, error);
  if (!adapter.changed()) throw protocolError("CONTENT_MISMATCH");
  const state = draft.onlineState;
  const cooldown = skillNumber(info.cooltime) * 1000;
  if (!Number.isSafeInteger(cooldown) || cooldown < 0) {
    throw protocolError("CONTENT_MISMATCH");
  }
  state.cooldowns[`skill:${skill.id}`] = world.now + cooldown;
  if (buff) installBuff(state, skill.id, buff, world.now);
  return { value: { skillId: skill.id } };
}

function installBuff(state, id, buff, now) {
  const index = state.effects.findIndex(
    (effect) => effect.kind === "skill" && effect.templateId === id,
  );
  if (index < 0 && state.effects.length >= 64) {
    throw protocolError("SERVER_BUSY");
  }
  const effect = {
    id: randomUUID(),
    kind: "skill",
    templateId: id,
    cancelable: true,
    expiresAt: now + buff.duration,
    duration: buff.duration,
    spec: buff.values,
  };
  if (index >= 0) state.effects.splice(index, 1);
  state.effects.push(effect);
}

function preparePhysical(actor, skill, info, rank) {
  if (
    !actor.combat ||
    ![30, 31, 32, 33, 40, 41, 42, 43, 44].includes(actor.stats.weaponType)
  ) {
    throw protocolError("REQUIREMENTS_NOT_MET");
  }
  const damageInfo = physicalDamageInfo(info);
  const action =
    typeof info.action === "string"
      ? info.action
      : (skill.actions[0] ?? actor.combat.defaultAction);
  if (!actor.actionPoses[action]?.length) {
    throw protocolError("CONTENT_MISMATCH");
  }
  const rectangle = physicalRectangle(actor, action, info);
  return {
    id: skill.id,
    rank,
    action,
    info: damageInfo,
    rectangle,
  };
}

function physicalDamageInfo(info) {
  const damage = skillNumber(info.damage);
  const count = skillNumber(info.mobCount, 1);
  if (
    !Number.isSafeInteger(damage) ||
    damage <= 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 6
  ) {
    throw protocolError("CONTENT_MISMATCH");
  }
  return { damage, mobCount: count, range: skillNumber(info.range) };
}

function physicalRectangle(actor, action, info) {
  let rectangle = actor.combat.attacks[action]?.rectangle ?? null;
  if (info.lt && info.rb) {
    rectangle = {
      left: info.lt.x,
      top: info.lt.y,
      right: info.rb.x,
      bottom: info.rb.y,
    };
  }
  if (!rectangle) throw protocolError("CONTENT_MISMATCH");
  return rectangle;
}

function prepareCastAction(actor, skill, info) {
  const action =
    typeof info.action === "string" ? info.action : (skill.actions[0] ?? null);
  if (action === null) return { action: null, duration: 0 };
  const frames = actor.actionPoses[action];
  if (!frames?.length || frames.length > 4096) {
    throw protocolError("CONTENT_MISMATCH");
  }
  let duration = 0;
  for (const frame of frames) {
    if (!Number.isSafeInteger(frame.delay) || frame.delay <= 0) {
      throw protocolError("CONTENT_MISMATCH");
    }
    duration += frame.delay;
  }
  return { action, duration };
}
