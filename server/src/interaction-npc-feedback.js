import {
  INTERACTION_LIMITS,
  requireInteraction,
} from "./interaction-common.js";

const REWARDS_PER_EVENT = 128;

/** A maximal bounded VM turn must not overflow the 64KiB server wire frame. */
function rewardEvents(value) {
  requireInteraction(
    value.items.length <= INTERACTION_LIMITS.effects,
    "CONTENT_MISMATCH",
  );
  const result = [];
  const parts = Math.max(1, Math.ceil(value.items.length / REWARDS_PER_EVENT));
  for (let part = 0; part < parts; part++) {
    result.push({
      kind: "narrative.reward",
      ...value,
      items: value.items.slice(
        part * REWARDS_PER_EVENT,
        (part + 1) * REWARDS_PER_EVENT,
      ),
      mesos: part === 0 ? value.mesos : 0,
      exp: part === 0 ? value.exp : 0,
      fame: part === 0 ? value.fame : 0,
      levels: part === 0 ? value.levels : 0,
      questClear: part === 0 && value.questClear,
    });
  }
  return result;
}

export function npcRewardEvents(lease, result) {
  const items = [];
  let mesos = 0;
  for (const effect of result.effects) {
    if (effect.kind === "item" && effect.show && effect.delta > 0) {
      items.push({ itemId: effect.itemId, amount: effect.delta });
    } else if (effect.kind === "meso" && effect.delta > 0)
      {mesos += effect.delta;}
  }
  if (!items.length && !mesos) return [];
  return rewardEvents({
    source: "npc",
    sourceId: lease.npcTemplateId,
    items,
    mesos,
    exp: 0,
    fame: 0,
    levels: 0,
    questClear: false,
  });
}

export function questRewardEvents(record, stage, result) {
  const items = result.rewards.items
    .filter((item) => item.count > 0)
    .map((item) => ({ itemId: item.id, amount: item.count }));
  return rewardEvents({
    source: "quest",
    sourceId: record.id,
    items,
    mesos: result.rewards.money,
    exp: result.rewards.exp,
    fame: result.rewards.pop,
    levels: result.levels,
    questClear: stage === 1,
  });
}

/** Outbox effects are published only by the freshly committed turn, never receipt replay. */
export function publishNarrativeEvents(actor, receipt, world) {
  if (!receipt.applied) return;
  for (const event of receipt.events) {
    try {
      world.publish(actor, {
        type: "event",
        fieldEpoch: actor.field.epoch,
        event,
      });
    } catch (error) {
      world.deliveryFailed(actor, error);
      return;
    }
  }
}
