import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash, resource, publishFile } from "../tools/atlas.js";
import { createExtractionCache } from "../tools/extraction-cache.js";

const RECIPE = hash(Buffer.from("recipe-one"));
const sourceHash = (value) => ({
  sha256: hash(Buffer.from(value)),
  bytes: Buffer.byteLength(value),
});

async function workspace(run) {
  const root = await mkdtemp(join(tmpdir(), "maple-extraction-cache-"));
  const paths = {
    directory: join(root, "cache"),
    output: join(root, "generated"),
    sources: { "Map.wz:a.img": "first", "Map.wz:b.img": "other" },
  };
  try {
    await mkdir(join(paths.output, "references"), { recursive: true });
    await run(paths);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function session(paths, options = {}) {
  const state = {
    output: paths.output,
    rgbaBytes: 0,
    textures: {},
    atlases: {},
    regions: {},
    tiledCanvases: {},
  };
  const retained = new Set();
  const cache = await createExtractionCache({
    directory: paths.directory,
    state,
    ...options,
    source(key) {
      if (!Object.hasOwn(paths.sources, key)) {
        throw new Error(`Missing original source ${key}`);
      }
      return sourceHash(paths.sources[key]);
    },
    retain: (key) => retained.add(key),
  });
  return { cache, state, retained };
}

function unit(name, options = {}) {
  return {
    id: `map/${name}`,
    recipe: RECIPE,
    sources: [`Map.wz:${name}.img`],
    ...options,
  };
}

function publish(paths, value) {
  return resource(
    paths.output,
    "references",
    "json",
    Buffer.from(JSON.stringify(value)),
  );
}

function unexpectedBuild() {
  throw new Error("Verified unchanged unit should have been reused");
}

test("content and recipe changes rebuild only dependent units, with retained warm provenance", async () => {
  await workspace(async (paths) => {
    const cold = await session(paths);
    const first = await cold.cache.run(unit("a"), () =>
      publish(paths, paths.sources["Map.wz:a.img"]),
    );
    const other = await cold.cache.run(unit("b"), () =>
      publish(paths, paths.sources["Map.wz:b.img"]),
    );
    const warm = await session(paths);
    expect(await warm.cache.run(unit("a"), unexpectedBuild)).toEqual(first);
    expect(await warm.cache.run(unit("b"), unexpectedBuild)).toEqual(other);
    expect([...warm.retained].sort()).toEqual(
      Object.keys(paths.sources).sort(),
    );
    paths.sources["Map.wz:a.img"] = "later";
    const changed = await session(paths);
    const replacement = await changed.cache.run(unit("a"), () =>
      publish(paths, paths.sources["Map.wz:a.img"]),
    );
    expect(replacement.sha256).not.toBe(first.sha256);
    expect(await changed.cache.run(unit("b"), unexpectedBuild)).toEqual(other);
    const revised = await session(paths);
    const newRecipe = unit("a", { recipe: hash(Buffer.from("recipe-two")) });
    const rebuilt = await revised.cache.run(newRecipe, () =>
      publish(paths, "new conversion semantics"),
    );
    expect(rebuilt.sha256).not.toBe(replacement.sha256);
    expect(await revised.cache.run(unit("b"), unexpectedBuild)).toEqual(other);
  });
});

test("transitive corrupt bytes are repaired even when the direct manifest remains intact", async () => {
  await workspace(async (paths) => {
    const leaf = Buffer.from("original artwork bytes");
    async function build() {
      const artwork = await resource(paths.output, "references", "bin", leaf);
      return publish(paths, { artwork });
    }
    const cold = await session(paths);
    const result = await cold.cache.run(unit("a"), build);
    const manifest = await Bun.file(
      join(paths.output, result.url.slice(11)),
    ).json();
    const path = join(paths.output, manifest.artwork.url.slice(11));
    await Bun.write(path, Buffer.alloc(leaf.length, 0));
    const repaired = await session(paths);
    expect(await repaired.cache.run(unit("a"), build)).toEqual(result);
    expect(Buffer.from(await Bun.file(path).arrayBuffer())).toEqual(leaf);
    expect(repaired.cache.evidence.units[0].reason).toContain(
      "output-corrupt-or-missing",
    );
    const warm = await session(paths);
    expect(await warm.cache.run(unit("a"), unexpectedBuild)).toEqual(result);
  });
});

test("damaged cache payload cannot supply a previously successful result", async () => {
  await workspace(async (paths) => {
    const cold = await session(paths);
    const original = await cold.cache.run(unit("a"), () =>
      publish(paths, "original"),
    );
    const records = await readdir(join(paths.directory, "records"));
    await Bun.write(join(paths.directory, "records", records[0]), "{}");
    const next = await session(paths);
    const replacement = await next.cache.run(unit("a"), () =>
      publish(paths, "rebuilt after corruption"),
    );
    expect(replacement.sha256).not.toBe(original.sha256);
    expect(next.cache.evidence.units[0].reason).toBe("cache-payload-corrupt");
  });
});

test("shared atlas assignments invalidate dependent publication even with unchanged original inputs", async () => {
  await workspace(async (paths) => {
    const cold = await session(paths);
    cold.state.textures.shared = { atlas: "first", x: 1 };
    const original = await cold.cache.run(unit("a"), () =>
      publish(paths, { texture: cold.state.textures.shared }),
    );
    const unchanged = await session(paths);
    unchanged.state.textures.shared = { atlas: "first", x: 1 };
    expect(await unchanged.cache.run(unit("a"), unexpectedBuild)).toEqual(
      original,
    );
    const changed = await session(paths);
    changed.state.textures.shared = { atlas: "second", x: 7 };
    const rebuilt = await changed.cache.run(unit("a"), () =>
      publish(paths, { texture: changed.state.textures.shared }),
    );
    const content = await Bun.file(
      join(paths.output, rebuilt.url.slice(11)),
    ).json();
    expect(content.texture).toEqual({ atlas: "second", x: 7 });
    expect(rebuilt.sha256).not.toBe(original.sha256);
  });
});

test("a later failed unit retains both the previous catalog and earlier successful unit cache", async () => {
  await workspace(async (paths) => {
    const catalogPath = join(paths.output, "catalog.json");
    const previous = JSON.stringify({ buildId: "last-complete-release" });
    await publishFile(catalogPath, previous);
    const failed = await session(paths);
    const successful = await failed.cache.run(unit("a"), () =>
      publish(paths, "completed unit"),
    );
    await expect(
      failed.cache.run(unit("b"), async () => {
        await publish(paths, "uncommitted partial output");
        throw new Error("Original source rejected");
      }),
    ).rejects.toThrow("Original source rejected");
    expect(await Bun.file(catalogPath).text()).toBe(previous);
    const retry = await session(paths);
    expect(await retry.cache.run(unit("a"), unexpectedBuild)).toEqual(
      successful,
    );
    const finished = await retry.cache.run(unit("b"), () =>
      publish(paths, "complete replacement"),
    );
    await publishFile(
      catalogPath,
      JSON.stringify({ maps: { a: successful, b: finished } }),
    );
    expect((await Bun.file(catalogPath).json()).maps.b).toEqual(finished);
  });
});

test("changed prerequisite datasets and complete preflight source sets invalidate cached results", async () => {
  await workspace(async (paths) => {
    const cold = await session(paths);
    const first = await cold.cache.run(
      unit("a", { prerequisites: { server: "one" } }),
      () => publish(paths, "server one"),
    );
    const changed = await session(paths);
    const second = await changed.cache.run(
      unit("a", { prerequisites: { server: "two" } }),
      () => publish(paths, "server two"),
    );
    expect(second.sha256).not.toBe(first.sha256);
    const expanded = await session(paths);
    const closure = unit("a", {
      prerequisites: { server: "two" },
      sources: Object.keys(paths.sources),
    });
    const third = await expanded.cache.run(closure, () =>
      publish(paths, "new transitive owner"),
    );
    expect(third.sha256).not.toBe(second.sha256);
    const missing = await session(paths);
    delete paths.sources["Map.wz:b.img"];
    await expect(missing.cache.run(closure, unexpectedBuild)).rejects.toThrow(
      "Missing original source",
    );
  });
});

test("repeated cached image observations remain dependencies of every consuming unit", async () => {
  await workspace(async (paths) => {
    const cold = await session(paths);
    await cold.cache.run(unit("a"), () =>
      publish(paths, paths.sources["Map.wz:a.img"]),
    );
    const original = await cold.cache.run(unit("b"), () => {
      cold.cache.observe("Map.wz:a.img");
      return publish(paths, { shared: paths.sources["Map.wz:a.img"] });
    });
    paths.sources["Map.wz:a.img"] = "shared source changed";
    const changed = await session(paths);
    const replacement = await changed.cache.run(unit("b"), () => {
      changed.cache.observe("Map.wz:a.img");
      return publish(paths, { shared: paths.sources["Map.wz:a.img"] });
    });
    expect(replacement.sha256).not.toBe(original.sha256);
    expect(changed.cache.evidence.units[0].reason).toContain("source-changed");
  });
});
