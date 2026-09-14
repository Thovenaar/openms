import { migrateDatabase } from "../../tools/migrate.js";
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { openDatabase } from "../src/database.js";
import { createContentService } from "../src/content-authoring.js";
import {
  loadWorldContent,
  WorldActivation,
  worldResourceResponse,
} from "../src/world-content.js";
import { OnlineWorld } from "../src/world.js";
import { questOffers } from "../src/interaction-quest.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import {
  mobInput,
  questDefinition,
  originalRef,
  originalFixture,
} from "../../content/test/fixtures.js";
import { sameWorldIdentity } from "../../shared/world-content.js";
import { digest } from "../../content/src/digest.js";

async function withWorld(run) {
  const url = process.env.OPENMS_TEST_DATABASE_URL;
  const admin = new SQL(url, { max: 1, connectionTimeout: 5 });
  const name = `openms_world_${crypto.randomUUID().replaceAll("-", "")}`;
  let database,
    created = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    created = true;
    const isolated = new URL(url);
    isolated.pathname = `/${name}`;
    await migrateDatabase({ databaseUrl: isolated.href });
    const { original } = await originalFixture();
    database = await openDatabase({
      url: isolated.href,
      items: original.items,
    });
    const service = createContentService(database, original);
    await service.initialize(original.catalog);
    const content = await loadWorldContent(database, original);
    const world = new OnlineWorld({ content, database, publish() {} });
    const activation = new WorldActivation({ database, content, service });
    activation.bind(world, { joining: new Set() });
    await run({ original, database, service, content, world, activation });
    await world.close();
  } finally {
    await database?.close();
    try {
      if (created) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.close({ timeout: 5 });
    }
  }
}

export async function seedWorldContent(service, original) {
  const owner = "author";
  await service.save(owner, mobInput(original.assetBuildId));
  const mob = await service.publish(owner, {
    projectId: "forest",
    id: "mossback",
    revision: 1,
  });
  const base = await original.map("100000000");
  const floor = base.physics.footholds.find((row) => row.x1 < row.x2);
  const ref = { source: "custom", kind: "mob", id: "mossback", revision: 1 };
  const definition = {
    base: originalRef("map", "100000000"),
    entities: [],
    spawns: [
      {
        id: "mossback",
        mob: ref,
        x: floor.x1,
        y: floor.y1,
        foothold: floor.id,
        range: { left: floor.x1, right: floor.x2 },
        facing: 1,
      },
    ],
  };
  await service.save(
    owner,
    mobInput(original.assetBuildId, {
      id: "grove",
      kind: "map",
      name: "Shared Grove",
      definition,
    }),
  );
  const map = await service.publish(owner, {
    projectId: "forest",
    id: "grove",
    revision: 1,
  });
  await service.save(
    owner,
    mobInput(original.assetBuildId, {
      id: "hunt",
      kind: "quest",
      name: "Mossback hunt",
      definition: questDefinition(ref),
    }),
  );
  const quest = await service.publish(owner, {
    projectId: "forest",
    id: "hunt",
    revision: 1,
  });
  return { mob, map, quest };
}

function releaseInput(expectedGeneration = 0) {
  return {
    projectId: "forest",
    refs: [
      { id: "grove", revision: 1 },
      { id: "hunt", revision: 1 },
    ],
    expectedGeneration,
    operationId: crypto.randomUUID(),
  };
}

test.skipIf(!process.env.OPENMS_TEST_DATABASE_URL)(
  "activated database content loads shared fields and quest offers and survives restart",
  async () => {
    await withWorld(
      async ({ service, original, database, content, world, activation }) => {
        const { map, mob, quest } = await seedWorldContent(service, original);
        const input = releaseInput();
        const status = await activation.activate("author", input, () => {});
        expect(status.generation).toBe(1);
        expect(status.selection).toHaveLength(3);
        expect(
          (await activation.activate("author", input, () => {})).generation,
        ).toBe(1);
        const field = await world.fieldFor(map.runtimeId);
        expect(
          field.mobs.some(
            (entry) => Number(entry.template.originalId) === mob.runtimeId,
          ),
        ).toBe(true);
        const offers = questOffers(
          {
            profile: createProfile({
              mapId: String(map.runtimeId),
              x: 0,
              y: 0,
              facing: 1,
            }),
          },
          world,
          { npcTemplateId: 1012108 },
        );
        expect(offers.some((offer) => offer.questId === quest.runtimeId)).toBe(
          true,
        );
        const restarted = await loadWorldContent(database, original);
        expect((await restarted.map(map.runtimeId)).id).toBe(
          String(map.runtimeId),
        );
        expect(restarted.worldContent).toEqual(content.worldContent);
        expect(original.catalog.maps[map.runtimeId]).toBeUndefined();
        const descriptor = content.catalog.maps[map.runtimeId];
        const response = await worldResourceResponse(
          content,
          `resources/${descriptor.sha256}`,
        );
        expect(digest(new Uint8Array(await response.arrayBuffer()))).toBe(
          descriptor.sha256,
        );
        await expect(
          activation.activate("author", releaseInput(), () => {}),
        ).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
        world.actors.set("busy", {});
        await expect(
          activation.activate("author", releaseInput(1), () => {}),
        ).rejects.toThrow("Sign out");
        world.actors.delete("busy");
      },
    );
  },
  60000,
);

test("world handshake rejects stale releases while retaining original build identity", () => {
  const content = {
    rulesHash: "rules",
    assetBuildId: "assets",
    worldContent: { sha256: "new-release" },
  };
  expect(
    sameWorldIdentity(
      {
        rulesHash: "rules",
        assetBuildId: "assets",
        worldContentHash: "old-release",
      },
      content,
    ),
  ).toBe(false);
  expect(
    sameWorldIdentity(
      {
        rulesHash: "rules",
        assetBuildId: "assets",
        worldContentHash: "new-release",
      },
      content,
    ),
  ).toBe(true);
});

test.skipIf(!process.env.OPENMS_TEST_DATABASE_URL)(
  "world release replacement protects saved maps, quest progress and active leases",
  async () => {
    await withWorld(
      async ({ service, original, database, content, activation }) => {
        const { map, quest } = await seedWorldContent(service, original);
        await activation.activate("author", releaseInput(), () => {});
        expect(content.catalog.ui.minimaps[map.runtimeId].mapName).toBe(
          map.name,
        );
        expect(content.catalog.audiovisual.maps[map.runtimeId]).toEqual(
          original.catalog.audiovisual.maps[100000000],
        );
        expect(original.catalog.ui.minimaps[map.runtimeId]).toBeUndefined();
        const account = await database.createAccount({
          name: "guard",
          passwordHash: await Bun.password.hash("password"),
          role: "player",
        });
        const profile = createProfile({
          mapId: String(map.runtimeId),
          x: 0,
          y: 0,
          facing: 1,
        });
        profile.name = "Guard";
        await database.createCharacter(account.id, profile);
        const remove = () =>
          activation.activate(
            "author",
            { ...releaseInput(1), refs: [] },
            () => {},
          );
        await expect(remove()).rejects.toThrow("saved character");
        await database.sql`UPDATE character SET map_id=100000000,profile=jsonb_set(profile,'{quests}',${JSON.stringify({ [quest.runtimeId]: { state: 1 } })}::text::jsonb) WHERE account_id=${account.id}`;
        await expect(remove()).rejects.toThrow("progress");
        await database.sql`UPDATE character SET profile=jsonb_set(profile,'{quests}','{}'::jsonb),lease_until=clock_timestamp()+interval '30 seconds' WHERE account_id=${account.id}`;
        await expect(remove()).rejects.toThrow("lease");
        expect(activation.status().generation).toBe(1);
        await database.sql`UPDATE character SET lease_until=null WHERE account_id=${account.id}`;
        const empty = await remove();
        expect(empty.generation).toBe(2);
        expect(empty.selection).toHaveLength(0);
        expect(empty.busy).toBe(false);
        expect(content.catalog.maps[map.runtimeId]).toBeUndefined();
      },
    );
  },
  60000,
);
