import { migrateDatabase } from "../../tools/migrate.js";
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { PostgresContentStore } from "../src/postgres.js";
import { canonical, digest } from "../src/digest.js";
import { createContentService } from "../../server/src/content-authoring.js";
import { ContentHttp } from "../../server/src/content-http.js";
import { encodePNG } from "../../client/src/assets/png.js";
import {
  originalFixture,
  originalRef,
  mobInput,
  questDefinition,
} from "./fixtures.js";

const databaseUrl = process.env.OPENMS_TEST_DATABASE_URL;

/** Migrate only a fresh disposable database; the configured database is an admin connection. */
async function withStore(run) {
  const admin = new SQL(databaseUrl, { max: 1, connectionTimeout: 5 });
  const name = `openms_content_${crypto.randomUUID().replaceAll("-", "")}`;
  let sql,
    created = false;
  try {
    console.log("content check: create disposable database");
    await admin.unsafe(`CREATE DATABASE "${name}"`).simple();
    created = true;
    const url = new URL(databaseUrl);
    url.pathname = `/${name}`;
    sql = new SQL(url.href, { max: 4, connectionTimeout: 5 });
    console.log("content check: migrate schema");
    await migrateDatabase({ databaseUrl: url.href });
    await migrateDatabase({ databaseUrl: url.href });
    const { original } = await originalFixture();
    const service = createContentService({ sql }, original);
    console.log("content check: retain catalog snapshot");
    await service.initialize(original.catalog);
    console.log("content check: exercise publication");
    await run({ service, sql, original });
  } finally {
    await sql?.close({ timeout: 5 });
    try {
      if (created) await admin.unsafe(`DROP DATABASE "${name}"`).simple();
    } finally {
      await admin.close({ timeout: 5 });
    }
  }
}

async function proveRevisions({ service, sql, original }) {
  const input = mobInput(original.assetBuildId);
  const ref = { projectId: "forest", id: "mossback", revision: 1 };
  const first = await service.save("owner", input);
  console.log("content check: draft saved");
  expect(await service.save("owner", input)).toEqual(first);
  await expect(
    service.save("owner", { ...input, name: "Different" }),
  ).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
  await expect(service.store.get("other-owner", ref)).rejects.toMatchObject({
    code: "CONTENT_NOT_FOUND",
  });
  const published = await service.publish("owner", ref);
  console.log("content check: mob published");
  expect(published.runtime.template.info.maxHP).toBe(120);
  const restarted = createContentService({ sql }, original);
  expect(await restarted.published("owner", ref)).toEqual(published);
  expect(await restarted.publish("owner", ref)).toEqual(published);
  const changes = [1, 2].map(() =>
    service.save("owner", {
      ...input,
      expectedRevision: 1,
      operationId: crypto.randomUUID(),
    }),
  );
  const results = await Promise.allSettled(changes);
  console.log("content check: concurrent edits resolved");
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    results.find((result) => result.status === "rejected").reason.code,
  ).toBe("CONTENT_CONFLICT");
  expect(
    (await service.published("owner", ref)).runtime.template.info.maxHP,
  ).toBe(120);
  const listing = await service.store.list("owner", { projectId: "forest" });
  expect(listing[0].revision).toBe(2);
  expect(listing[0].runtime).toBeUndefined();
  await expect(editRevision(sql, 1)).rejects.toThrow("immutable");
  await expect(editRevision(sql, 2)).rejects.toThrow("publishing");
  console.log("content check: immutability verified");
  return published;
}

async function editRevision(sql, revision) {
  await sql`UPDATE custom_content SET name='Changed' WHERE owner_id='owner' AND id='mossback' AND revision=${revision}`;
}

async function proveQuest(service, mob) {
  const target = { source: "custom", kind: "mob", id: "mossback", revision: 1 };
  const input = mobInput(mob.baseAssetBuildId, {
    id: "hunt",
    kind: "quest",
    name: "Mossback hunt",
    definition: questDefinition(target),
  });
  await service.save("owner", input);
  const quest = await service.publish("owner", {
    projectId: "forest",
    id: "hunt",
    revision: 1,
  });
  expect(quest.runtime.dependencies[0].publicationHash).toBe(
    mob.publicationHash,
  );
  expect(JSON.stringify(quest.runtime.record)).toContain(String(mob.runtimeId));
  const broken = {
    ...input,
    id: "broken",
    operationId: crypto.randomUUID(),
    definition: questDefinition({ ...target, revision: 2 }),
  };
  await service.save("owner", broken);
  const ref = { projectId: "forest", id: "broken", revision: 1 };
  await expect(service.publish("owner", ref)).rejects.toThrow("published");
  expect((await service.store.get("owner", ref)).status).toBe("draft");
}

async function proveMapAndImage({ service, original }) {
  const bytes = encodePNG(1, 1, new Uint8Array([40, 150, 80, 255]));
  const upload = await service.upload("owner", bytes);
  expect((await service.store.image("owner", upload.id)).bytes).toEqual(
    new Uint8Array(bytes),
  );
  await expect(
    service.store.image("other-owner", upload.id),
  ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  const registry = await service.registry(original.assetBuildId);
  const base = await registry.map("001010000");
  const floor = base.physics.footholds.find((value) => value.x1 < value.x2);
  const definition = mapDefinition(upload, floor);
  await service.save(
    "owner",
    mobInput(original.assetBuildId, {
      id: "grove",
      kind: "map",
      name: "Grove",
      definition,
    }),
  );
  await proveRegion(service);
}

async function proveDependencyPins(service, mob) {
  await service.publish("owner", {
    projectId: "forest",
    id: "mossback",
    revision: 2,
  });
  const prerequisite = {
    source: "custom",
    kind: "quest",
    id: "hunt",
    revision: 1,
  };
  const definition = questDefinition({
    source: "custom",
    kind: "mob",
    id: "mossback",
    revision: 2,
  });
  definition.prerequisites = [prerequisite];
  await service.save(
    "owner",
    mobInput(mob.baseAssetBuildId, {
      id: "conflicting",
      kind: "quest",
      definition,
    }),
  );
  await expect(
    service.publish("owner", {
      projectId: "forest",
      id: "conflicting",
      revision: 1,
    }),
  ).rejects.toThrow("Conflicting dependency revisions");
}

async function proveDependencyCycles(service, mob) {
  const prerequisite = {
    source: "custom",
    kind: "quest",
    id: "hunt",
    revision: 1,
  };
  const linked = questDefinition();
  linked.prerequisites = [prerequisite];
  await service.save(
    "owner",
    mobInput(mob.baseAssetBuildId, {
      id: "linked",
      kind: "quest",
      definition: linked,
    }),
  );
  await service.publish("owner", {
    projectId: "forest",
    id: "linked",
    revision: 1,
  });
  linked.prerequisites = [{ ...prerequisite, id: "linked" }];
  await service.save(
    "owner",
    mobInput(mob.baseAssetBuildId, {
      id: "hunt",
      kind: "quest",
      expectedRevision: 1,
      definition: linked,
    }),
  );
  await expect(
    service.publish("owner", { projectId: "forest", id: "hunt", revision: 2 }),
  ).rejects.toThrow("dependency cycle");
}

function mapDefinition(upload, floor) {
  return {
    base: originalRef("map", "001010000"),
    entities: [
      {
        id: "flower",
        appearance: {
          source: "upload",
          assetId: upload.id,
          actions: {
            stand: [
              {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                originX: 0,
                originY: 0,
                delay: 100,
              },
            ],
          },
        },
        x: floor.x1,
        y: floor.y1,
        z: 0,
        flip: false,
      },
    ],
    spawns: [
      {
        id: "snail",
        mob: { source: "custom", kind: "mob", id: "mossback", revision: 1 },
        x: floor.x1,
        y: floor.y1,
        foothold: floor.id,
        range: { left: floor.x1, right: floor.x2 },
        facing: 1,
      },
    ],
  };
}

async function proveRegion(service) {
  const ref = { projectId: "forest", id: "grove", revision: 1 };
  const published = await service.publish("owner", ref);
  expect(await service.published("owner", ref)).toEqual(published);
  const region = published.runtime.manifest.regions.find(
    (value) => value.id === "custom-additions",
  );
  expect(digest(canonical(published.runtime.resources[region.sha256]))).toBe(
    region.sha256,
  );
  const http = new ContentHttp({
    service,
    auth: { session: () => ({ accountId: "owner" }) },
  });
  const result = await http.fetch(
    new Request(`http://localhost${region.url}`),
    `regions/forest/grove/1/${region.sha256}`,
  );
  expect(result.status).toBe(200);
  expect(digest(new Uint8Array(await result.arrayBuffer()))).toBe(
    region.sha256,
  );
}

test.skipIf(!databaseUrl)(
  "PostgreSQL authoring persists immutable publications, resolves mixed assets and isolates owners",
  async () => {
    await withStore(async (context) => {
      const mob = await proveRevisions(context);
      await proveQuest(context.service, mob);
      await proveMapAndImage(context);
      await proveDependencyPins(context.service, mob);
      await proveDependencyCycles(context.service, mob);
    });
  },
  60000,
);

test.skipIf(!databaseUrl)(
  "new extraction snapshots cannot silently change an existing pinned build",
  async () => {
    await withStore(async ({ service, sql, original }) => {
      const next = structuredClone(original.catalog);
      next.buildId = "b".repeat(64);
      next.monsters[100101].name = "Updated Snail";
      await service.initialize(next);
      const store = new PostgresContentStore(sql);
      expect(
        (await store.build(original.assetBuildId)).monsters[100101].name,
      ).toBe("Blue Snail");
      expect((await store.build(next.buildId)).monsters[100101].name).toBe(
        "Updated Snail",
      );
      await expect(
        store.registerBuild({ ...next, defaultMap: "different" }),
      ).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
    });
  },
  60000,
);
