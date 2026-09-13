import { referenceKey } from "./definitions.js";

function emptyCheck() {
  return { items: [], mobs: [], quests: [], jobs: [] };
}
function emptyAct() {
  return { items: [], quests: [], exp: 0, money: 0, pop: 0, nextQuest: null };
}
function page(text) {
  return [{ index: 0, text }];
}
function say(text, accepted) {
  return {
    pages: page(text),
    yes: page(accepted),
    no: [],
    stop: {},
    choices: {},
    npc: null,
  };
}

function targetId(ref, dependencies) {
  return ref.source === "custom"
    ? dependencies.get(referenceKey(ref)).runtimeId
    : Number(ref.id);
}

/** Emits the existing two-stage declarative contract; reward authority remains in quest-rules. */
export function compileQuest(row, dependencies) {
  const value = row.definition;
  const start = {
    check: emptyCheck(),
    actionCheck: emptyCheck(),
    act: emptyAct(),
    say: say(value.dialogue.offer, value.dialogue.accepted),
  };
  const end = {
    check: emptyCheck(),
    actionCheck: emptyCheck(),
    act: emptyAct(),
    say: say(value.dialogue.complete, value.dialogue.complete),
  };
  start.check.npc = Number(value.startNpc.id);
  start.check.lvmin = value.minLevel;
  start.check.lvmax = value.maxLevel;
  start.check.quests = value.prerequisites.map((ref, index) => ({
    id: targetId(ref, dependencies),
    state: 2,
    index,
  }));
  end.check.npc = Number(value.endNpc.id);
  addObjectives(value, end, dependencies);
  end.act.exp = value.rewards.exp;
  end.act.money = value.rewards.meso;
  for (const reward of value.rewards.items) {
    end.act.items.push(
      itemAction(Number(reward.item.id), reward.count, end.act.items.length),
    );
  }
  end.say.stop = {
    mob: page(value.dialogue.progress),
    item: page(value.dialogue.progress),
    default: page(value.dialogue.progress),
  };
  const record = {
    id: row.runtimeId,
    name: row.name,
    info: {
      name: row.name,
      0: value.dialogue.offer,
      1: value.dialogue.progress,
      2: value.dialogue.complete,
      area: 0,
    },
    stages: [start, end],
    supported: true,
    blockers: [],
    unavailableBranches: [],
    dependencies: questDependencies(value, start, end),
    provenance: { source: "custom", id: row.id, revision: row.revision },
  };
  return { kind: "quest", record };
}

function questDependencies(value, start, end) {
  return {
    npcIds: [start.check.npc, end.check.npc],
    mobIds: end.check.mobs.map((mob) => mob.id),
    itemIds: [
      ...end.check.items.map((item) => item.id),
      ...value.rewards.items.map((item) => Number(item.item.id)),
    ],
    questIds: start.check.quests.map((quest) => quest.id),
    mapIds: [Number(value.startNpc.mapId), Number(value.endNpc.mapId)],
    scriptRefs: [],
    artworkPaths: [],
  };
}

function addObjectives(value, end, dependencies) {
  for (const [index, objective] of value.objectives.entries()) {
    const id = targetId(objective.target, dependencies);
    const entry = { id, count: objective.count, index };
    if (objective.kind === "kill") end.check.mobs.push(entry);
    else {
      end.check.items.push(entry);
      end.act.items.push(
        itemAction(id, -objective.count, end.act.items.length),
      );
    }
  }
}

function itemAction(id, count, index) {
  return { id, count, index };
}
