import {
  CONTENT_LIMITS,
  integer,
  list,
  originalRef,
  record,
  reference,
  requireContent,
  text,
} from "./validation.js";

/** First authoring contract: NPC endpoints, hunt/collect objectives, prerequisites and fixed rewards. */
export function validateQuest(value) {
  record(value, [
    "startNpc",
    "endNpc",
    "minLevel",
    "maxLevel",
    "prerequisites",
    "objectives",
    "rewards",
    "dialogue",
  ]);
  originalRef(value.startNpc, ["npc"], "startNpc");
  originalRef(value.endNpc, ["npc"], "endNpc");
  integer(value.minLevel, 1, 200);
  integer(value.maxLevel, value.minLevel, 200);
  for (const prerequisite of list(value.prerequisites, 64)) {
    reference(prerequisite, ["quest"], "prerequisites");
  }
  for (const objective of list(value.objectives, CONTENT_LIMITS.objectives)) {
    record(objective, ["kind", "target", "count"]);
    requireContent(
      ["kill", "collect"].includes(objective.kind),
      "Unsupported quest objective",
    );
    reference(objective.target, objective.kind === "kill" ? ["mob"] : ["item"]);
    integer(objective.count, 1, 9999);
  }
  record(value.rewards, ["exp", "meso", "items"]);
  integer(value.rewards.exp, 0, 2147483647);
  integer(value.rewards.meso, 0, 2147483647);
  for (const reward of list(value.rewards.items, 64)) {
    record(reward, ["item", "count"]);
    originalRef(reward.item, ["item"]);
    integer(reward.count, 1, 9999);
  }
  record(value.dialogue, ["offer", "accepted", "progress", "complete"]);
  for (const [key, line] of Object.entries(value.dialogue)) {
    text(line, 4096, `dialogue/${key}`);
    requireContent(
      !line.includes("#"),
      "Use plain dialogue text; markup is not an authoring operation",
      `dialogue/${key}`,
    );
  }
  uniqueTargets(value.prerequisites, (ref) => `${ref.source}:${ref.id}`);
  uniqueTargets(
    value.objectives,
    (entry) => `${entry.kind}:${entry.target.source}:${entry.target.id}`,
  );
  uniqueTargets(value.rewards.items, (entry) => entry.item.id);
}

function uniqueTargets(values, key) {
  const identities = values.map(key);
  requireContent(
    new Set(identities).size === identities.length,
    "Duplicate quest target",
  );
}
