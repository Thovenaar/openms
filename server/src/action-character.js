import {
  apField,
  admitAp,
  apGain,
  catalogJobs,
} from "../../client/src/character/ap-rules.js";
import { recalculateVitals } from "../../client/src/character/character-stats.js";
import {
  allocationError,
  allocateSkill,
  profileSkillLevel,
} from "../../client/src/skills/skill-allocation-rules.js";
import { consumeItem } from "../../client/src/items/inventory-model.js";
import {
  prepareItemSpec,
  applyAlchemist,
  applyItemVitals,
} from "../../client/src/items/item-effects.js";
import { USE_INTERVAL_MS } from "../../client/src/items/item-use.js";
import {
  TemporaryStats,
  temporaryState,
  configureTemporaryState,
  MAX_TEMPORARY_STATS,
} from "../../client/src/skills/temporary-stats.js";
import {
  admitActor,
  onlineState,
  ownedItem,
  reject,
  ruleError,
  createServerRandom,
} from "./action-rules.js";

import { executeNativePreference } from "./action-native.js";
// Online command engineering bound; each point still uses the shared reference-policy rule.
export const MAX_ALLOCATION_BATCH = 256;

function allocateStats(profile, action, context) {
  if (
    action.amount > MAX_ALLOCATION_BATCH ||
    action.amount > profile.remainingAp
  ) {
    reject(
      "REQUIREMENTS_NOT_MET",
      "AP allocation exceeds the bounded batch or available points.",
    );
  }
  const catalog = context.world.content.catalog;
  const jobs = catalogJobs(catalog);
  const growth = { random: context.random, now: context.now };
  for (let point = 0; point < action.amount; point++) {
    // The explicit protocol HP/MP intent replaces only the offline UI warning, not its admissions.
    admitAp(profile, action.stat, true, jobs);
    profile[apField(action.stat)] += apGain(
      profile,
      action.stat,
      catalog,
      growth,
    );
    profile.remainingAp--;
  }
  recalculateVitals(
    profile,
    context.world.content.items,
    context.actor.temporaryStats?.derived,
  );
}

function allocateSkills(profile, action, context) {
  if (profile.hp <= 0 || action.amount > MAX_ALLOCATION_BATCH) {
    reject(
      "REQUIREMENTS_NOT_MET",
      "Skill allocation requires a living character and bounded batch.",
    );
  }
  const skill = context.world.content.catalog.ui.skills[action.skillId];
  for (let point = 0; point < action.amount; point++) {
    const reason = allocationError(profile, skill, context.now);
    if (reason) reject("REQUIREMENTS_NOT_MET", reason);
    allocateSkill(profile, skill);
  }
}

function cancelBuff(profile, action, context) {
  const effects = onlineState(profile).effects;
  const index = effects.findIndex((effect) => effect.id === action.effectId);
  const effect = effects[index];
  if (!effect || effect.expiresAt <= context.now) {
    reject("NOT_FOUND", "The owned effect is no longer active.");
  }
  if (!effect.cancelable || !["item", "skill"].includes(effect.kind)) {
    reject(
      "NOT_ALLOWED",
      "Hostile or noncancelable effects cannot be cleared.",
    );
  }
  effects.splice(index, 1);
  const temporary = new TemporaryStats();
  projectEffects(profile, context.now, temporary);
  recalculateVitals(profile, context.world.content.items, temporary.derived);
}

export async function executeCharacter(actor, message, world, operation) {
  const context = {
    actor,
    world,
    now: world.now,
    random: createServerRandom(),
  };
  return world.database.commit(actor, operation, (profile) => {
    try {
      admitActor(actor, world, message.fieldEpoch);
      context.now = world.now;
      switch (message.action.kind) {
        case "stats.allocate":
          allocateStats(profile, message.action, context);
          break;
        case "skills.allocate":
          allocateSkills(profile, message.action, context);
          break;
        case "buff.cancel":
          cancelBuff(profile, message.action, context);
          break;
        case "settings.save":
        case "key-bindings.save":
        case "skill-macros.save":
        case "quest.track":
        case "quest.notice":
          executeNativePreference(profile, message.action, context);
          break;
        default:
          reject("INVALID_MESSAGE", "Not a character mutation.");
      }
      return {};
    } catch (error) {
      throw ruleError(error);
    }
  });
}

function alchemist(profile, context) {
  const skills = context.world.content.catalog.ui.skills;
  return {
    level(id) {
      return profileSkillLevel(skills, profile, id, context.now);
    },
    info(id, rank) {
      return skills[id]?.levels?.[rank];
    },
  };
}

/** Validated item effect publication is represented durably before its live stat projection. */
export function useItem(profile, action, context) {
  const item = ownedItem(profile, context.actor, action.itemId, context.now);
  const otherTarget =
    action.target &&
    (action.target.kind !== "entity" ||
      action.target.entityId !== context.actor.id);
  if (item.slot < 0 || item.count < 1 || otherTarget) {
    reject(
      "NOT_ALLOWED",
      "The admitted consumable is an owned inventory self-use item.",
    );
  }
  const state = onlineState(profile);
  if ((state.cooldowns["item.use"] ?? 0) > context.now) {
    reject("COOLDOWN", "Item-use admission interval is active.");
  }
  const effect = prepareItemSpec(context.items[item.id]);
  if (!effect) {
    reject(
      "REQUIREMENTS_NOT_MET",
      "This item requires an unavailable conditional, targeted, pickup or special effect controller.",
    );
  }
  applyAlchemist(effect, alchemist(profile, context));
  if (effect.state) installItemEffect(state, item.id, effect, context.now);
  consumeItem(profile, item.uid, 1);
  applyItemVitals(profile, effect.values);
  state.cooldowns["item.use"] = context.now + USE_INTERVAL_MS;
  return {};
}

function installItemEffect(state, templateId, effect, now) {
  const index = state.effects.findIndex(
    (entry) => entry.kind === "item" && entry.templateId === templateId,
  );
  if (index < 0 && state.effects.length >= MAX_TEMPORARY_STATS) {
    reject("SERVER_BUSY", "Temporary stat capacity is full.");
  }
  const row = {
    id: crypto.randomUUID(),
    templateId,
    kind: "item",
    cancelable: true,
    expiresAt: now + effect.values.time,
    duration: effect.values.time,
    spec: { ...effect.values },
  };
  if (index >= 0) state.effects.splice(index, 1);
  state.effects.push(row);
}

/** Rebuild only at join/commit boundaries. Runtime ticks reuse the prepared source arrays. */
export function rebuildActorEffects(actor, world) {
  actor.temporaryStats ??= new TemporaryStats();
  projectEffects(actor.profile, world.now, actor.temporaryStats);
  recalculateVitals(
    actor.profile,
    world.content.items,
    actor.temporaryStats.derived,
  );
}

function projectEffects(profile, now, temporary) {
  const effects = onlineState(profile).effects;
  if (effects.length > MAX_TEMPORARY_STATS) {
    reject("CONTENT_MISMATCH", "Persisted temporary stat capacity is invalid.");
  }
  temporary.clear();
  for (const effect of effects) {
    if (effect.expiresAt <= now) continue;
    const state = temporaryState(effect.kind, effect.templateId);
    configureTemporaryState(state, effect.spec, effect.expiresAt - now);
    state.expiresAt = effect.expiresAt;
    state.itemValues = effect.spec;
    temporary.start(state);
  }
}

/** Bounded, allocation-free expiration; world owns checkpoint/revision publication of the change. */
export function expireActorEffects(actor, world) {
  const effects = actor.profile.onlineState?.effects;
  if (!effects) return false;
  let changed = false;
  for (let index = effects.length - 1; index >= 0; index--) {
    const effect = effects[index];
    if (effect.expiresAt > world.now) continue;
    actor.temporaryStats?.remove(
      effect.kind === "item" ? -effect.templateId : effect.templateId,
    );
    effects.splice(index, 1);
    changed = true;
  }
  if (changed) {
    actor.temporaryStats?.recompute();
    recalculateVitals(
      actor.profile,
      world.content.items,
      actor.temporaryStats?.derived,
    );
  }
  return changed;
}
