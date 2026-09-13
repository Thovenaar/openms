import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { OnlineWorld } from "../src/world.js";
import { advanceCombat, prepareActorCombat } from "../src/field-combat.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { createSimulation } from "../../client/src/physics/simulation.js";

const content = await loadContent();

/** Real extracted geometry and damage rules; only RNG and player placement are controlled. */
async function fixture(mapId = 100010000, templateId = 130101) {
  const publications = [];
  const world = new OnlineWorld({
    content,
    database: {},
    publish(actor, message) {
      publications.push(message);
    },
  });
  world.now = 0;
  world.nextUint32 = () => 9999999;
  const field = await world.fieldFor(mapId);
  const mob = field.mobs.find(
    (entry) => entry.active && entry.templateId === templateId,
  );
  if (!mob) {
    throw new Error("Combat fixture requires its authored active monster");
  }
  field.mobs = [mob];
  const arrival = { x: mob.x, y: mob.y, facing: 1 };
  const profile = createProfile({ mapId: field.manifest.id, ...arrival });
  const actor = {
    id: "receiver",
    state: "active",
    profile,
    field,
    pending: false,
    pendingDamage: 0,
    pendingMpDamage: 0,
    simulation: createSimulation(field.manifest.physics, arrival),
  };
  prepareActorCombat(world, actor);
  field.characters.set(actor.id, actor);
  return { world, field, actor, mob, publications };
}

function impacts(probe) {
  return probe.publications.filter(
    (message) => message.event?.kind === "combat",
  );
}

function step(probe, milliseconds) {
  probe.world.now += milliseconds;
  probe.field.tick++;
  advanceCombat(probe.world, probe.field);
}

test("authored ground contact lowers beginner HP and respects repeat-hit protection", async () => {
  const probe = await fixture();
  const hp = probe.actor.profile.hp;
  step(probe, 30);
  const hit = impacts(probe)[0].event.hits[0];
  expect(hit.outcome).toBe("hit");
  expect(hit.damage).toBeGreaterThan(0);
  expect(probe.actor.profile.hp).toBe(hp - hit.damage);
  expect(probe.publications).toContainEqual({ type: "snapshot-request" });
  step(probe, 30);
  expect(impacts(probe)).toHaveLength(1);
  expect(probe.actor.profile.hp).toBe(hp - hit.damage);
  step(probe, 1500);
  expect(impacts(probe)).toHaveLength(2);
});

test("evaded contact publishes MISS without HP loss or recoil and protects against rerolls", async () => {
  const probe = await fixture();
  probe.actor.damage.nextUint32 = () => 0;
  const hp = probe.actor.profile.hp;
  const velocity = [probe.actor.simulation.vx, probe.actor.simulation.vy];
  step(probe, 30);
  expect(impacts(probe)[0].event.hits[0]).toEqual({
    targetId: probe.actor.id,
    damage: 0,
    outcome: "miss",
  });
  expect(probe.actor.profile.hp).toBe(hp);
  expect([probe.actor.simulation.vx, probe.actor.simulation.vy]).toEqual(
    velocity,
  );
  probe.actor.damage.nextUint32 = () => 9999999;
  step(probe, 30);
  expect(impacts(probe)).toHaveLength(1);
  expect(probe.actor.profile.hp).toBe(hp);
  step(probe, 1500);
  expect(probe.actor.profile.hp).toBeLessThan(hp);
});

test("Magic Guard publishes incoming magnitude while deferring only actual HP and MP loss", async () => {
  const probe = await fixture();
  probe.actor.temporaryStats = { derived: { magicGuard: 100 } };
  probe.actor.pending = true;
  const hp = probe.actor.profile.hp;
  const mp = probe.actor.profile.mp;
  step(probe, 30);
  const hit = impacts(probe)[0].event.hits[0];
  expect(hit.damage).toBeGreaterThan(0);
  expect(hit.outcome).toBe("hit");
  expect(probe.actor.profile.hp).toBe(hp);
  expect(probe.actor.profile.mp).toBe(mp);
  expect(probe.actor.pendingDamage).toBe(Math.max(0, hit.damage - mp));
  expect(probe.actor.pendingMpDamage).toBe(Math.min(mp, hit.damage));
});

test("Tauromacis releases its original area only at attackAfter and cannot repeat the impact", async () => {
  const probe = await fixture(105090500, 7130100);
  probe.actor.profile.hp = 30000;
  // Stay inside the left-facing authored area, outside ordinary contact.
  probe.mob.facing = -1;
  probe.actor.simulation.x = probe.mob.x - 200;
  probe.mob.cooldownMs = 0;
  step(probe, 30);
  expect(probe.mob.state).toBe("attack");
  const attack = probe.mob.pendingAttack;
  expect(impacts(probe)).toHaveLength(0);
  for (
    let elapsed = 30;
    elapsed < attack.properties.attackAfter;
    elapsed += 30
  ) {
    step(probe, 30);
  }
  expect(impacts(probe)).toHaveLength(0);
  step(probe, 30);
  const hit = impacts(probe)[0].event.hits[0];
  expect(hit.damage).toBeGreaterThan(0);
  expect(probe.actor.profile.hp).toBe(30000 - hit.damage);
  step(probe, 30);
  expect(impacts(probe)).toHaveLength(1);
});

test("faulted mob geometry cannot deal stale contact damage", async () => {
  const probe = await fixture();
  probe.mob.fault = "unsupported-controller";
  const hp = probe.actor.profile.hp;
  step(probe, 30);
  expect(probe.actor.profile.hp).toBe(hp);
  expect(impacts(probe)).toHaveLength(0);
});
