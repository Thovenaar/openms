import { expect, test } from "bun:test";
import { developActor } from "../src/field-development.js";
import { loadContent } from "../src/content.js";
import { advanceDrops } from "../src/field-drops.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { itemStackLimit } from "../../client/src/items/inventory-model.js";

const content = await loadContent();

function fixture() {
  const receipts = new Map(),
    grants = [],
    observations = [];
  const field = {
    epoch: "field",
    characters: new Map(),
    drops: new Map(),
    dropReservations: 0,
    geometry: { segments: [{ id: 1, x1: 0, x2: 600, y1: 100, y2: 100 }] },
  };
  const actor = {
    id: "developer",
    role: "developer",
    state: "active",
    field,
    revision: 0,
    developmentReceipts: new Map(),
    connection: { data: { epoch: "connection", ready: true } },
    simulation: { x: 200, y: 100, facing: 1 },
    profile: createProfile({ mapId: "000050000", x: 200, y: 100, facing: 1 }),
  };
  field.characters.set(actor.id, actor);
  field.characters.set("player", { id: "player", role: "player" });
  const world = {
    content,
    development: true,
    now: 1000,
    participants: { busy: () => false, signalIdle() {} },
    invalidateField() {},
    broadcast: (_, message) => {
      for (const id of field.characters.keys()) {
        observations.push({ id, message });
      }
    },
    database: {
      receipt: async (_, operation) => receipts.get(operation.operationId),
      commit: async (_, operation, mutator) => {
        const plan = mutator();
        grants.push(...plan.grantEntitlements);
        const receipt = { status: "committed", code: "OK", value: plan.value };
        receipts.set(operation.operationId, receipt);
        return receipt;
      },
    },
  };
  return { world, actor, field, grants, observations };
}

function conjure(
  probe,
  action = { kind: "conjure", itemId: 2000000, quantity: 2 },
  operationId = crypto.randomUUID(),
) {
  return developActor(probe.world, probe.actor, {
    action,
    operationId,
    connectionEpoch: "connection",
  });
}

test("conjure grants one drop entitlement, publishes to the shared field, and replay creates no duplicate", async () => {
  const probe = fixture(),
    operationId = crypto.randomUUID();
  const before = structuredClone(probe.actor.profile.inventory);
  const first = await conjure(probe, undefined, operationId);
  expect(await conjure(probe, undefined, operationId)).toEqual(first);
  expect(probe.field.drops.size).toBe(1);
  expect(probe.grants).toHaveLength(1);
  expect(probe.actor.profile.inventory).toEqual(before);
  advanceDrops(probe.world, probe.field);
  expect(probe.observations.map((entry) => entry.id)).toEqual([
    "developer",
    "player",
  ]);
  expect(probe.field.dropReservations).toBe(0);
});

test("ordinary players and oversized original stacks cannot conjure", async () => {
  const probe = fixture();
  probe.actor.role = "player";
  await expect(conjure(probe)).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  probe.actor.role = "developer";
  await expect(
    conjure(probe, {
      kind: "conjure",
      itemId: 2000000,
      quantity: itemStackLimit(content.items[2000000]) + 1,
    }),
  ).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
  expect(probe.grants).toHaveLength(0);
});
