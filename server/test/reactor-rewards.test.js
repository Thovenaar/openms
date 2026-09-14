import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { OnlineWorld } from "../src/world.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { createSimulation } from "../../client/src/physics/simulation.js";
import { compileReactorReward } from "../../client/tools/reactor-reward-compiler.js";

const content = await loadContent();

async function fixture() {
  const events = [];
  const policy = {
    programs: {
      2001: compileReactorReward({ text: "function act(){rm.dropItems();}" }),
    },
    rows: {
      2001: [
        { itemId: 4031161, questId: 1008, chance: 1 },
        { itemId: 4031162, questId: 1008, chance: 1 },
      ],
    },
  };
  const ownContent = Object.assign(Object.create(content), {
    catalog: {
      ...content.catalog,
      drops: { ...content.catalog.drops, reactors: policy },
    },
  });
  const world = new OnlineWorld({
    content: ownContent,
    database: {},
    publish: (actor, message) => events.push({ actor: actor.id, message }),
  });
  const field = await world.fieldFor(1000000);
  const profile = createProfile({
    mapId: "001000000",
    x: 570,
    y: 274,
    facing: 1,
  });
  profile.quests[1008] = { state: 1, kills: {} };
  const actor = {
    id: crypto.randomUUID(),
    state: "active",
    profile,
    field,
    revision: 0,
    simulation: createSimulation(field.manifest.physics, profile.location),
  };
  field.characters.set(actor.id, actor);
  field.characters.set("observer", { id: "observer", state: "active" });
  return { world, field, actor, events };
}

const geometry = {
  rectangle: { left: 580, right: 640, top: 180, bottom: 280 },
  facing: 1,
  skillId: 0,
};

function breakBox(probe) {
  for (let index = 0; index < 4; index++) {
    expect(probe.world.strikeReactor(probe.actor, geometry)).toBe(true);
    probe.field.reactors.step(1000);
  }
}

test("one terminal box generation grants one durable drop batch and broadcasts each hit to both players", async () => {
  const probe = await fixture();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const grants = [];
  probe.world.participants.commitProduced = async (
    actor,
    operation,
    ids,
    produce,
  ) => {
    const result = produce(
      new Map([[actor.id, structuredClone(actor.profile)]]),
    );
    grants.push(result.grantEntitlements);
    await gate;
    return { status: "committed", value: result.value };
  };
  breakBox(probe);
  expect(probe.world.strikeReactor(probe.actor, geometry)).toBe(false);
  expect(probe.field.drops.size).toBe(0);
  expect(probe.field.dropReservations).toBe(2);
  release();
  await probe.field.reactors.waitForIdle();
  expect(grants).toHaveLength(1);
  expect(probe.field.drops.size).toBe(2);
  expect(probe.field.dropReservations).toBe(0);
  expect([...probe.field.drops.values()].map((drop) => drop.itemId)).toEqual([
    4031161, 4031162,
  ]);
  expect(
    probe.events.filter((row) => row.message.event?.kind === "world.reactor"),
  ).toHaveLength(8);
});

test("a failed reactor reward transaction publishes no loot and releases all reserved capacity", async () => {
  const probe = await fixture();
  probe.world.participants.commitProduced = async (
    actor,
    operation,
    ids,
    produce,
  ) => {
    produce(new Map([[actor.id, structuredClone(actor.profile)]]));
    throw new Error("durable write refused");
  };
  breakBox(probe);
  await probe.field.reactors.waitForIdle();
  expect(probe.field.drops.size).toBe(0);
  expect(probe.field.dropReservations).toBe(0);
  expect(probe.actor.admission).toBe("durable write refused");
});
