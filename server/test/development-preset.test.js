import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { developActor } from "../src/field-development.js";
import { prepareActorCombat } from "../src/field-combat.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";

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
      async commit(actor, operation, mutator) {
        const draft = structuredClone(actor.profile);
        draft.onlineState = { probe: true };
        await mutator(draft);
        committed.push({ operation, draft });
        return { status: "committed", value: { kind: operation.kind } };
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
  };
  actor.field.characters.set(actor.id, actor);
  prepareActorCombat(world, actor);
  return { world, actor, committed, published };
}

function develop({ world, actor }, operationId, action) {
  return developActor(world, actor, { operationId, action });
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
  expect(probe.published).toContainEqual({ type: "snapshot-request" });
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
