import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { convertServerData, readSqlInventory } from "../tools/server-data.js";

const SQL_ROOT = resolve(import.meta.dir, "../../infra/sql");

test("vendored SQL matches its source manifest and preserves upstream provenance", async () => {
  const manifest = await Bun.file(join(SQL_ROOT, "manifest.json")).json();
  const inventory = await readSqlInventory(SQL_ROOT);
  expect(manifest.files).toHaveLength(37);
  expect(inventory.files).toHaveLength(manifest.files.length);
  for (const record of manifest.files) {
    const bytes = await Bun.file(join(SQL_ROOT, record.path)).arrayBuffer();
    expect(bytes.byteLength).toBe(record.bytes);
    expect(
      createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
    ).toBe(record.sha256);
    expect(
      inventory.files.find((file) => file.source === record.source),
    ).toMatchObject({ bytes: record.bytes, sha256: record.sha256 });
  }
});

test("reference conversion uses repository-owned scripts and SQL by default", async () => {
  const result = await convertServerData();
  expect(result.report.sqlFiles).toHaveLength(37);
  expect(result.report.scripts.files).toHaveLength(1915);
  expect(result.datasets.shops.tables.shops).toHaveLength(110);
  expect(result.datasets.drops.tables.drop_data).toHaveLength(22157);
  expect(result.datasets.shops.tables.accounts).toBeUndefined();
  expect(
    result.datasets.shops.sources.some(
      (source) =>
        source.source.endsWith(".java") || source.source === "config.yaml",
    ),
  ).toBe(false);
});
