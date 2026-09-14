import { expect, test } from "bun:test";
import { extractQuests } from "../tools/quest-data.js";
import { QuestSystem } from "../src/quests/quest-system.js";
import { DropSystem } from "../src/world/drop-system.js";
import { ProfileStore } from "./fixtures/memory-profile-store.js";
import { createProfile } from "../src/profile/profile-validation.js";
import { itemCount } from "../src/items/inventory-model.js";

const LOCATION = { mapId: "000040000", x: 0, y: 0, facing: 1 };
const HATS = [1002053, 1002008, 1002014, 1002068, 1002069];
const SHELL = 4031802;
const GROUND = [{ x1: -100, y1: 0, x2: 100, y2: 0, layer: 0, group: 0 }];
const SENTINEL = { templateId: 9300018, x: 0, y: 0 };

/** Bounded original-node-shaped fixture, not a live archive or generated release dependency. */
function imageTree(input) {
  const root = { name: "", type: "Property", children: {} };
  const queue = [{ input, node: root }];
  for (let index = 0; index < queue.length; index++) {
    if (queue.length > 512) throw new Error("Quest fixture node bound");
    const { input: fields, node } = queue[index];
    for (const [name, value] of Object.entries(fields)) {
      const branch = value !== null && typeof value === "object";
      const child = { name, type: branch ? "Property" : "value", children: {} };
      node.children[name] = child;
      if (branch) queue.push({ input: value, node: child });
      else child.value = value;
    }
  }
  return root;
}

function questCatalog(rewards, tutorial = false) {
  const images = {
    "Check.img": {
      1035: {
        0: { npc: 2004, job: { 0: 0 }, lvmax: 10 },
        1: {
          npc: 2002,
          ...(tutorial
            ? {
                item: { 0: { id: SHELL, count: 1 } },
                mob: { 0: { id: 9300018, count: 1 } },
              }
            : {}),
        },
      },
    },
    "Act.img": {
      1035: { 0: {}, 1: { item: rewards, exp: tutorial ? 30 : 0 } },
    },
    "Say.img": {
      1035: { 0: { 0: "Try hunting." }, 1: { 0: "You learned to hunt." } },
    },
    "QuestInfo.img": { 1035: { name: "Todd's Hunting Method", area: 20 } },
  };
  return extractQuests({
    mapIds: [],
    image: (archive, path) =>
      imageTree(archive === "Quest" ? (images[path] ?? {}) : {}),
  });
}

function itemTemplates(ids) {
  return Object.fromEntries(
    ids.map((id) => [id, { id, info: { slotMax: 100 }, descriptor: {} }]),
  );
}

function questStore() {
  const profile = createProfile(LOCATION);
  profile.level = 5;
  return ProfileStore.memory(profile);
}

function land(drops) {
  for (let tick = 0; tick < 100; tick++) {
    if (
      drops.slots.every((slot) => !slot.active || slot.state === "grounded")
    ) {
      return;
    }
    drops.step(30);
  }
  throw new Error("Tutorial drop failed to land within100ticks");
}

const TUTORIAL_DROPS = {
  schemaVersion: 1,
  mobs: {
    9300018: {
      rows: [
        {
          itemId: SHELL,
          minimum: 1,
          maximum: 1,
          chance: 999999,
          questId: 1035,
          status: "supported",
        },
      ],
    },
  },
};

// Original Quest.wz:Act.img/1035/1/item and Cosmic152-drop-data.sql source row11179.
test("authored weighted finish rewards no longer block starting the tutorial shellpiece drop quest", async () => {
  const rewards = HATS.map((id) => ({ id, count: 1, job: 1, prop: 1 }));
  rewards.push({ id: SHELL, count: -1 });
  const catalog = questCatalog(rewards, true);
  const store = questStore();
  const items = itemTemplates([...HATS, SHELL]);
  let draws = 0;
  const random = () => {
    draws++;
    return 0.9;
  };
  const quests = new QuestSystem(catalog, store, { items, random });
  const drops = new DropSystem(TUTORIAL_DROPS, store, GROUND, {
    items,
    random,
    pickupHeight: () => 60,
  });
  try {
    expect(drops.spawn(SENTINEL).count).toBe(0);
    expect(draws).toBe(0);
    expect((await quests.begin(1035, 2004)).ok).toBe(true);
    expect(draws).toBe(0);
    quests.applyKill(store.profile, SENTINEL.templateId);
    expect(drops.spawn(SENTINEL).count).toBe(1);
    land(drops);
    expect((await drops.pickup(LOCATION)).ok).toBe(true);
    expect(itemCount(store.profile, SHELL)).toBe(1);
    expect((await quests.complete(1035, 2002)).ok).toBe(true);
    expect(itemCount(store.profile, SHELL)).toBe(0);
    expect(HATS.map((id) => itemCount(store.profile, id))).toEqual([
      0, 0, 0, 0, 1,
    ]);
    expect(store.profile.quests[1035].state).toBe(2);
    expect(store.profile.exp).toBe(30);
    expect(draws).toBe(2);
    expect(drops.spawn(SENTINEL).count).toBe(0);
    expect((await quests.complete(1035, 2002)).code).toBe("storage-failure");
    expect(draws).toBe(2);
  } finally {
    drops.destroy();
    await expect(store.destroy()).rejects.toMatchObject({
      code: "storage-failure",
      cause: { code: "completed" },
    });
  }
});

test("zero weights never grant and cumulative weights exclude ineligible jobs without preview RNG", async () => {
  const rewards = [
    { id: 4000000, count: 1 },
    { id: 4000001, count: 1, prop: 0 },
    { id: 4000002, count: 1, prop: 100, job: 2 },
    { id: 4000003, count: 1, prop: 2, job: 1 },
    { id: 4000004, count: 1, prop: 3, job: 1 },
  ];
  for (const [sample, expected] of [
    [0.39999, 4000003],
    [0.4, 4000004],
  ]) {
    const store = questStore();
    let draws = 0;
    const quests = new QuestSystem(questCatalog(rewards), store, {
      items: itemTemplates(rewards.map((item) => item.id)),
      random: () => {
        draws++;
        return sample;
      },
    });
    try {
      expect((await quests.begin(1035, 2004)).ok).toBe(true);
      const dialogue = quests.openDialogue(1035, 2002);
      dialogue.snapshot();
      dialogue.snapshot();
      expect(draws).toBe(0);
      expect((await quests.complete(1035, 2002)).ok).toBe(true);
      expect(store.profile.inventory.map((item) => item.id)).toEqual([
        4000000,
        expected,
      ]);
      expect(draws).toBe(1);
    } finally {
      await store.destroy();
    }
  }
});

test("unrepresentable weighted source rows remain inadmissible", async () => {
  const catalog = questCatalog([{ id: 4000000, count: 1, prop: 0.5 }]);
  const store = questStore();
  const quests = new QuestSystem(catalog, store);
  try {
    expect(quests.status(catalog.records[1035], 2004).code).toBe("unsupported");
    expect((await quests.begin(1035, 2004)).code).toBe("storage-failure");
    expect(store.profile.quests[1035]).toBeUndefined();
    expect(store.profile.inventory).toEqual([]);
  } finally {
    await expect(store.destroy()).rejects.toMatchObject({
      code: "storage-failure",
      cause: { code: "unsupported" },
    });
  }
});
