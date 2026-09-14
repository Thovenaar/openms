import { test, expect } from "bun:test";
import { ReactorSystem } from "../src/world/reactor-system.js";
import {
  PROFILE_LIMITS,
  createProfile,
} from "../src/profile/profile-validation.js";
import { ProfileStore } from "./fixtures/memory-profile-store.js";
import { extractReactors } from "../tools/reactor-data.js";
import { OfflineField } from "../src/combat/offline-field.js";
import { createWeaponUse } from "../src/combat/weapon-usage.js";

function offeringFixture(entries, observer) {
  const inventory = Array.from({ length: entries }, (_, index) => ({
    id: 2000000 + index,
    count: 2,
    uid: `reactor-${index}`,
    slot: index + 1,
    owner: "",
    flags: 0,
    expiresAt: null,
  }));
  const event = {
    type: 100,
    state: -1,
    skills: [],
    hitMs: 0,
    count: 1,
    itemOption: 1,
    itemId: 2000000,
    status: "local-data-transition",
    lt: { x: -10, y: -10 },
    rb: { x: 10, y: 10 },
  };
  const scene = {
    simulation: { x: 0, y: 0 },
    byId: new Map(),
    manifest: {
      reactors: {
        schemaVersion: 1,
        placements: [
          { id: "offering", templateId: "1", x: 0, y: 0, respawnMs: 0 },
        ],
        templates: {
          1: {
            quest: null,
            action: null,
            states: [{ id: 0, events: [event], timeoutMs: 0, hitMs: 0 }],
          },
        },
      },
    },
  };
  const profile = createProfile({ mapId: "100000000", x: 0, y: 0, facing: 1 });
  profile.inventory = inventory;
  profile.inventorySlots[1] = entries;
  const store = ProfileStore.memory(profile);
  const system = new ReactorSystem(scene, store, {
    onChange: () => observer(store.profile.inventory[0].count),
  });
  return { system, store, request: { uid: "reactor-0", actorId: store.id } };
}

test("offering accepts the shared profile capacity and publishes the debited inventory once", async () => {
  const observations = [];
  const { system, store, request } = offeringFixture(
    PROFILE_LIMITS.inventory,
    (count) => observations.push(count),
  );
  expect((await system.offer(request)).consumed).toBe(1);
  expect(observations).toEqual([1]);
  expect(store.profile.inventory[0].count).toBe(1);
  expect((await system.offer(request)).accepted).toBe(false);
  system.destroy();
  await store.destroy();
});

test("an observer failure cannot separate a committed transition from its item debit", async () => {
  const { system, store, request } = offeringFixture(1, () => {
    throw new Error("observer failure");
  });
  expect((await system.offer(request)).accepted).toBe(true);
  expect(store.profile.inventory[0].count).toBe(1);
  expect((await system.offer(request)).accepted).toBe(false);
  system.destroy();
  await store.destroy();
});

test("a pending offer rejects repeated input and another local actor without extra debit", async () => {
  const { system, store, request } = offeringFixture(1, () => {});
  expect(
    (await system.offer({ ...request, actorId: "another-character" })).code,
  ).toBe("invalid-actor");
  const first = system.offer(request);
  expect((await system.offer(request)).code).toBe("reactor-busy");
  expect((await first).accepted).toBe(true);
  expect(store.profile.inventory[0].count).toBe(1);
  expect((await system.offer(request)).accepted).toBe(false);
  system.destroy();
  await store.destroy();
});

const MAX_FIXTURE_NODES = 64;

function reactorProperty(name, value) {
  const root = { name };
  const pending = [{ node: root, value }];
  for (let index = 0; index < pending.length; index++) {
    const current = pending[index];
    const property =
      current.value !== null && typeof current.value === "object";
    current.node.type = property ? "Property" : typeof current.value;
    current.node.value = property ? undefined : current.value;
    current.node.children = {};
    if (!property) continue;
    const entries = Object.entries(current.value);
    if (pending.length + entries.length > MAX_FIXTURE_NODES) {
      throw new Error("Reactor fixture node bound exceeded");
    }
    for (const [key, child] of entries) {
      const node = { name: key };
      current.node.children[key] = node;
      pending.push({ node, value: child });
    }
  }
  return root;
}

test("the original negative reactor timer stays terminal while a positive timer respawns", async () => {
  const template = reactorProperty("2118002.img", {
    info: {},
    0: { event: { 0: { type: 101, state: -1 }, timeOut: 1 } },
  });
  const map = reactorProperty("211042300.img", {
    reactor: {
      0: { id: "2118002", x: 0, y: 0, reactorTime: -1 },
      1: { id: "2118002", x: 0, y: 0, reactorTime: 1 },
    },
  });
  const context = {
    image(archive) {
      return archive === "Reactor"
        ? template
        : reactorProperty("Reactor.img", {});
    },
  };
  const { reactors } = await extractReactors(context, map, "211042300");
  const system = new ReactorSystem(
    { manifest: { reactors }, byId: new Map(), simulation: { x: 0, y: 0 } },
    null,
  );
  try {
    system.step(1);
    expect(system.snapshot().records.map((record) => record.state)).toEqual([
      -1, -1,
    ]);
    system.step(1000);
    expect(system.snapshot().records.map((record) => record.state)).toEqual([
      -1, 0,
    ]);
  } finally {
    system.destroy();
  }
});

function strikingFixture() {
  const animation = {
    container: { visible: true },
    frame: 0,
    current: { geometry: [{ x: -10, y: -40, width: 20, height: 40 }] },
    setAction() {},
    seek() {},
    advance() {},
  };
  const event = {
    type: 1,
    state: -1,
    skills: [],
    hitMs: 0,
    status: "local-data-transition",
  };
  const scene = {
    simulation: { x: 0, y: 0, footholdId: 1 },
    byId: new Map([["reactor", animation]]),
    manifest: {
      reactors: {
        schemaVersion: 1,
        placements: [
          {
            id: "close",
            templateId: "1",
            entityId: "reactor",
            x: 50,
            y: 0,
            respawnMs: 0,
          },
        ],
        templates: {
          1: {
            quest: 1000,
            states: [
              {
                id: 0,
                idle: "stand",
                events: [event],
                timeoutMs: 0,
                hitMs: 0,
              },
            ],
          },
        },
      },
    },
  };
  const store = { profile: { quests: { 1000: { state: 1 } } } };
  return { system: new ReactorSystem(scene, store), store, scene };
}

test("close-reactor probing preserves quest, direction and overlap admission without consuming a strike", () => {
  const { system, store, scene } = strikingFixture();
  const rect = { left: 0, right: 65, top: -40, bottom: 0 };
  expect(system.canStrike(rect, -1)).toBe(false);
  store.profile.quests[1000].state = 0;
  expect(system.canStrike(rect, 1)).toBe(false);
  store.profile.quests[1000].state = 1;
  scene.manifest.reactors.placements[0].x = 76;
  expect(system.canStrike(rect, 1)).toBe(false);
  scene.manifest.reactors.placements[0].x = 50;
  expect(system.canStrike(rect, 1)).toBe(true);
  expect(system.canStrike(rect, 1)).toBe(true);
  expect(system.strike(rect, 1)).toBe(true);
  expect(system.canStrike(rect, 1)).toBe(false);
  expect(system.strike(rect, 1)).toBe(false);
  expect(system.records[0].transitions).toBe(1);
  system.destroy();
});

test("bow and claw close-reactor fallback uses real admission and one ammo-free impact", () => {
  for (const [weaponType, attack, action, itemId] of [
    [45, 3, "swingT1", 2060000],
    [47, 7, "stabO1", 2070000],
  ]) {
    const { system, scene } = strikingFixture();
    scene.simulation.facing = 1;
    const ammunition = { id: itemId, count: 2 };
    const field = Object.assign(Object.create(OfflineField.prototype), {
      simulation: scene.simulation,
      combat: {
        weaponType,
        equipment: { attack },
        attacks: {
          [action]: {
            rectangle: { left: -100, right: 0, top: -40, bottom: 0 },
          },
        },
      },
      useContext: {
        ammunition,
        randomWord: 0,
        crouching: false,
        closeTarget: false,
        items: { [itemId]: { info: { incPAD: 0 } } },
      },
      weaponUse: createWeaponUse(),
      attackBody: {},
      mobs: [],
      hooks: {
        canStrike: system.canStrike.bind(system),
        onStrike: system.strike.bind(system),
      },
    });
    // The reactor overlaps the ordinary100px swing, but not the65px close probe.
    scene.manifest.reactors.placements[0].x = 76;
    field.probeMeleeTarget();
    expect(field.weaponUse.ranged).toBe(true);
    scene.manifest.reactors.placements[0].x = 50;
    field.probeMeleeTarget();
    expect(field.weaponUse.ranged).toBe(false);
    field.consumeAmmunition();
    expect(ammunition.count).toBe(2);
    field.attack = field.combat.attacks[field.weaponUse.action];
    field.playerImpact();
    expect(system.records[0].transitions).toBe(1);
    expect(system.strike(field.attackBody, 1)).toBe(false);
    system.destroy();
  }
});
