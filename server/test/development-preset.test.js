import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { developActor } from "../src/field-development.js";
import { prepareActorCombat } from "../src/field-combat.js";
import { prepareActorSkills } from "../src/field-skills.js";
import { OnlineWorld } from "../src/world.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import {
  applyJobPresetLoadout,
  stageJobPreset,
} from "../../client/src/development/character-presets.js";
import { createSimulation } from "../../client/src/physics/simulation.js";

const content = await loadContent();

/** Detached stand-in for the durable commit: one draft per admitted transaction. */
async function fixture() {
  const manifest = await content.map(content.catalog.defaultMap);
  const arrival = nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 });
  const profile = createProfile({
    mapId: manifest.id,
    x: arrival.x,
    y: arrival.y,
    facing: arrival.facing ?? 1,
  });
  profile.name = "PresetProbe";
  const committed = [];
  const published = [];
  let seed = 123456789;
  const nextUint32 = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  const world = {
    development: true,
    now: 0,
    random: () => nextUint32() / 0x7fffffff,
    nextUint32,
    content,
    publish: (actor, message) => published.push(message),
    invalidateField() {},
    database: {
      async receipt() {
        return null;
      },
    },
    participants: {
      busy: () => false,
      signalIdle() {},
      async commit(actor, operation, ids, mutator) {
        const draft = structuredClone(actor.profile);
        draft.onlineState = { probe: true };
        await mutator(new Map([[actor.id, draft]]));
        committed.push({ operation, draft });
        return { status: "committed", code: "OK" };
      },
    },
  };
  const actor = {
    id: "actor-1",
    role: "developer",
    realm: "development:probe",
    state: "active",
    revision: 7,
    accountId: "account-1",
    profile,
    simulation: { x: arrival.x, y: arrival.y, facing: 1 },
    field: { characters: new Map(), epoch: 3, manifest, paused: false },
    developmentReceipts: new Map(),
    connection: { data: { epoch: "connection", ready: true } },
  };
  actor.field.characters.set(actor.id, actor);
  prepareActorCombat(world, actor);
  return { world, actor, committed, published };
}

function develop({ world, actor }, operationId, action) {
  return developActor(world, actor, {
    operationId,
    action,
    connectionEpoch: "connection",
  });
}

test("a staged preset and the developer's explicit edits commit as one draft", async () => {
  const probe = await fixture();
  const receipt = await develop(probe, "op-combined", {
    kind: "preset",
    job: 520,
    patch: { name: "Preset Probe", str: 700 },
  });
  expect(receipt.status).toBe("committed");
  expect(probe.committed.length).toBe(1);
  const draft = probe.committed[0].draft;
  // Explicit edits survive the preset loadout instead of being dropped.
  expect(draft.name).toBe("Preset Probe");
  expect(draft.str).toBe(700);
  expect(draft.job).toBe(520);
  expect(draft.exp).toBe(0);
  expect(draft.equipment.some((item) => item.slot === -11)).toBe(true);
  expect(Object.keys(draft.skills).length).toBeGreaterThan(0);
  expect(draft.onlineState).toEqual({ probe: true });
  expect(Object.hasOwn(draft, "patch")).toBe(false);
});

test("a preset without explicit edits still commits its staged job", async () => {
  const probe = await fixture();
  await develop(probe, "op-preset", { kind: "preset", job: 520 });
  expect(probe.committed.length).toBe(1);
  expect(probe.committed[0].draft.job).toBe(520);
});

test("every packaged job preset commits with ordinary players present", async () => {
  const jobs = content.catalog.ui.coverage.skillCoverage.playerBooks;
  expect(jobs.length).toBeLessThanOrEqual(1024);
  for (const job of jobs) {
    const probe = await fixture();
    probe.actor.field.characters.set("player", {
      role: "player",
      state: "active",
    });
    await develop(probe, `preset-${job}`, { kind: "preset", job });
    expect(probe.committed).toHaveLength(1);
    expect(probe.committed[0].draft.job).toBe(job);
  }
});

test("the staged Bandit (420) preset admits its authored Savage Blow attack", async () => {
  const index = content.catalog.ui;
  const manifest = await content.map(content.catalog.defaultMap);
  const base = createProfile({
    mapId: manifest.id,
    x: 0,
    y: 0,
    facing: 1,
  });
  const preset = stageJobPreset(index, base, 420);
  const profile = structuredClone(base);
  Object.assign(profile, preset.patch);
  applyJobPresetLoadout(profile, index, 420);
  profile.onlineState = { effects: [], cooldowns: {} };
  expect(profile.job).toBe(420);
  expect(profile.skills[4201005].level).toBeGreaterThan(0);
  const weapon = profile.equipment.find((item) => item.slot === -11);
  expect(weapon.id).toBe(1332000);
  const combat = index.avatar.entries[weapon.id].combat;
  expect(combat.weaponType).toBe(33);

  const world = new OnlineWorld({ content, database: {}, publish() {} });
  world.now = 0;
  world.nextUint32 = () => 9999999;
  const field = await world.fieldFor(manifest.id);
  const actor = {
    id: "preset-bandit",
    state: "active",
    profile,
    field,
    pending: false,
    simulation: createSimulation(field.manifest.physics, {
      x: 0,
      y: 0,
      facing: 1,
    }),
    session: { revoked: false },
  };
  prepareActorCombat(world, actor);
  await prepareActorSkills(world, actor, null);
  const system = actor.skills;
  const id = 4201005;
  const rank = system.level(id);
  const info = system.info(id, rank);
  const record = actor.skillField.skillCombat.prepared.get(id);
  // Authored WZ: the dagger (Character.wz:Weapon/01332000.img) authors no `savage`
  // attack node, so the pose stays `savage` while the admitted rectangle falls back
  // to the weapon's ordinary action; a missing rectangle refuses the cast.
  expect(system.castError(system.catalog[id], info)).toBeNull();
  expect(record.action).toBe("savage");
  expect(record.rectangle).toEqual(
    combat.attacks[combat.defaultAction].rectangle,
  );
  system.destroy();
});

test("GM field controls allow other players, while player requests and busy peers are refused", async () => {
  const probe = await fixture();
  const peer = { role: "player", state: "active" };
  probe.actor.field.characters.set("player", peer);
  probe.world.neutralize = () => {};
  probe.world.database.commit = async () => ({
    status: "committed",
    code: "OK",
  });
  await develop(probe, "pause", { kind: "pause", paused: true });
  expect(probe.actor.field.paused).toBe(true);
  probe.actor.role = "player";
  await expect(
    develop(probe, "player-pause", { kind: "pause", paused: false }),
  ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  probe.actor.role = "developer";
  peer.pending = true;
  await expect(
    develop(probe, "busy", { kind: "pause", paused: false }),
  ).rejects.toMatchObject({ code: "SERVER_BUSY" });
  expect(probe.actor.field.paused).toBe(true);
});

test("an invalid combined draft commits nothing", async () => {
  const probe = await fixture();
  const rejected = develop(probe, "op-invalid", {
    kind: "preset",
    job: 520,
    patch: { level: 200, exp: 5 },
  });
  await expect(rejected).rejects.toMatchObject({
    code: "invalid-profile-edit",
  });
  expect(probe.committed.length).toBe(0);
});

test("an explicit job that contradicts the staged preset is rejected before any transaction", async () => {
  const probe = await fixture();
  const rejected = develop(probe, "op-mismatch", {
    kind: "preset",
    job: 520,
    patch: { job: 521 },
  });
  await expect(rejected).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
  expect(probe.committed.length).toBe(0);
});
