import { afterEach, expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { OnlineWorld } from "../src/world.js";
import { prepareActorCombat, refreshActorCombat } from "../src/field-combat.js";
import { prepareActorSkills, disposeActorSkills } from "../src/field-skills.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { PhysicalDamage } from "../../client/src/combat/physical-damage.js";
import { createWeaponUse } from "../../client/src/combat/weapon-usage.js";
import {
  createCharacterStats,
  projectCharacterStats,
} from "../../client/src/character/character-stats.js";
import {
  DAMAGE_LIMIT,
  shownDamageRange,
} from "../../shared/combat-formulas.js";
import { domainEventSchema } from "../../shared/protocol.js";
import { validate } from "../../shared/schema.js";

const content = await loadContent();
const probes = [];
afterEach(() => {
  for (const probe of probes) disposeActorSkills(probe.actor, true);
  probes.length = 0;
});

/** Current production authority runtime and real WZ metadata; persistence is outside this calculation test. */
async function fixture() {
  const publications = [];
  const world = new OnlineWorld({
    content,
    database: {},
    log() {},
    publish(actor, message) {
      publications.push(message);
    },
  });
  world.now = 0;
  world.nextUint32 = () => 9999999;
  const field = await world.fieldFor(100010000);
  const mob = field.mobs.find(
    (entry) => entry.active && entry.templateId === 130101,
  );
  if (!mob) {
    throw new Error("Formula fixture requires an authored active monster");
  }
  field.mobs = [mob];
  const profile = createProfile({
    mapId: field.manifest.id,
    x: mob.x,
    y: mob.y,
    facing: 1,
  });
  profile.level = 50;
  profile.str = 100;
  profile.dex = 20;
  profile.onlineState = { effects: [], cooldowns: {} };
  const actor = {
    id: "formula-player",
    profile,
    revision: 0,
    session: { expiresAt: Date.now() + 60000 },
  };
  world.prepareEntry(actor, field);
  prepareActorCombat(world, actor);
  await prepareActorSkills(world, actor);
  actor.state = "active";
  field.characters.set(actor.id, actor);
  world.actors.set(actor.id, actor);
  const probe = { world, field, actor, mob, publications };
  probes.push(probe);
  return probe;
}

test("server and client project the same modern stats and ordinary hit", async () => {
  const { actor, mob } = await fixture();
  const offline = projectCharacterStats(
    actor.profile,
    actor.statHooks,
    createCharacterStats(),
  );
  expect(offline).toEqual(actor.stats);
  const shown = {};
  shownDamageRange(offline, shown);
  // Starter sword PAD17: round(1.24 * (4*100+20) *17/100) =89.
  expect(shown).toEqual({ damageMin: 19, damageMax: 89 });
  const use = createWeaponUse();
  use.projectilePAD = 0;
  const server = actor.skillField.skillCombat.basicDamage(
    actor.stats,
    mob,
    use,
  );
  const client = new PhysicalDamage(Math.random, () => 9999999).generate(
    offline,
    mob.skillStatus.projected,
    100,
    use,
  );
  expect(server).toBe(client);
  expect(server).toBe(106);
});

test("server incoming admission uses modern defense without StandardPDD", async () => {
  const { world, actor, mob } = await fixture();
  actor.profile.level = mob.template.info.level;
  refreshActorCombat(world, actor);
  actor.skillField.incomingOptions.standardPDD = null;
  const admitted = actor.skillField.prepareMobHitAdmission(mob, false);
  expect(admitted.admitted).toBe(true);
  const client = new PhysicalDamage(Math.random, () => 9999999);
  expect(admitted.hit.amount).toBe(
    client.receive(actor.stats, mob.skillStatus.projected, { magic: false }),
  );
  expect(admitted.hit.amount).toBeGreaterThan(0);
});

test("modern dodge still records MISS without moving or debiting the player", async () => {
  const { world, actor, mob } = await fixture();
  actor.profile.luk = 1000;
  refreshActorCombat(world, actor);
  actor.skillField.damageGenerator.nextUint32 = () => 0;
  const before = [actor.profile.hp, actor.simulation.x, actor.simulation.y];
  const admitted = actor.skillField.prepareMobHitAdmission(mob, false);
  expect(admitted.admitted).toBe(true);
  expect(admitted.hit.amount).toBe(0);
  expect([actor.profile.hp, actor.simulation.x, actor.simulation.y]).toEqual(
    before,
  );
});

test("large generated damage survives publication while hpDamage is only HP actually removed", async () => {
  const { actor, mob, publications } = await fixture();
  // Isolate calculation/publication from the separate durable reward transaction.
  actor.skillField.onKill = () => {};
  const hp = mob.hp;
  const hit = {
    skillId: 0,
    skillLine: true,
    line: 0,
    critical: true,
    knockbackChance: 0,
    roll: 0,
  };
  actor.skillField.damageTarget(mob, DAMAGE_LIMIT, hit, 1);
  const event = publications.find(
    (message) => message.event?.kind === "combat.impact",
  ).event;
  expect(event.damage).toBe(DAMAGE_LIMIT);
  expect(event.hpDamage).toBe(hp);
  expect(event.critical).toBe(true);
  expect(event.lethal).toBe(true);
  expect(() => validate(event, domainEventSchema)).not.toThrow();
});
