import { expect, test } from "bun:test";
import { OnlineWorld } from "../src/world.js";
import { ServerContent } from "../src/content.js";
import { canRetireField } from "../src/field-retirement.js";

function field(mapId) {
  return {
    mapId,
    id: `field-${mapId}`,
    epoch: crypto.randomUUID(),
    characters: new Map(),
    mobs: [],
    npcs: new Map(),
    drops: new Map(),
    published: new Set(),
    reactors: {
      pending: null,
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
    },
  };
}

function worldFixture() {
  const world = new OnlineWorld({ content: {}, database: {}, publish() {} });
  world.createField = async (id, realm, key) => {
    const created = field(Number(id));
    world.fields.set(key, created);
    return created;
  };
  return world;
}

test("exploration beyond 128 fields retires idle LRU fields while preserving occupied and reserved identities", async () => {
  const world = worldFixture();
  const occupied = await world.fieldFor(1);
  occupied.characters.set("player", {});
  const held = await world.fieldFor(2, "public", true);
  const idle = await world.fieldFor(3);
  for (let id = 4; id <= 260; id++) await world.fieldFor(id);
  expect(world.fields.size).toBe(128);
  expect(await world.fieldFor(1)).toBe(occupied);
  expect(await world.fieldFor(2)).toBe(held);
  expect(idle.retired).toBe(true);
  expect(idle.reactors.destroyed).toBe(true);
  const reentered = await world.fieldFor(3);
  expect(reentered.epoch).not.toBe(idle.epoch);
  expect(reentered.retired).toBeUndefined();
});

test("pending drops, reactors, transitions and door endpoints prevent retirement", () => {
  const world = worldFixture();
  const target = field(1);
  expect(canRetireField(world, target)).toBe(true);
  for (const property of [
    "entryReservations",
    "travelReservations",
    "dropReservations",
  ]) {
    target[property] = 1;
    expect(canRetireField(world, target)).toBe(false);
    target[property] = 0;
  }
  target.drops.set("drop", {});
  expect(canRetireField(world, target)).toBe(false);
  target.drops.clear();
  target.reactors.pending = {};
  expect(canRetireField(world, target)).toBe(false);
  target.reactors.pending = null;
  world.actors.set("player", { transition: { target } });
  expect(canRetireField(world, target)).toBe(false);
  world.actors.set("player", {
    skills: {
      worldController: {
        door: {
          remainingMs: 1,
          source: { mapId: "000000001" },
          town: { mapId: "2" },
        },
      },
    },
  });
  expect(canRetireField(world, target)).toBe(false);
});

test("a fully reserved world rejects another load without evicting live state", async () => {
  const world = worldFixture();
  for (let id = 0; id < 128; id++) await world.fieldFor(id, "public", true);
  await expect(world.fieldFor(129)).rejects.toMatchObject({
    code: "SERVER_BUSY",
  });
  expect(world.fields.size).toBe(128);
});

test("content LRU releases cache references without mutating manifests retained by fields", async () => {
  const content = new ServerContent("unused-test-root");
  let loads = 0;
  content.loadMap = async (id) => {
    loads++;
    const manifest = Object.freeze({ id });
    content.maps.set(id, manifest);
    return manifest;
  };
  const retained = await content.map(1);
  for (let id = 2; id <= 260; id++) await content.map(id);
  expect(content.maps.size).toBe(128);
  expect(retained.id).toBe("000000001");
  const again = await content.map(1);
  expect(again).not.toBe(retained);
  expect(await content.map(1)).toBe(again);
  expect(loads).toBe(261);
});
