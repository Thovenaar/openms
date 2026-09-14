import { createHash } from "node:crypto";
import { readdir, lstat } from "node:fs/promises";
import { resolve } from "node:path";

export const DEFAULT_SQL_ROOT = resolve(import.meta.dir, "../infra/sql");
const MAX_MIGRATIONS = 256;
const MAX_SQL_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * MAX_SQL_BYTES;
const MIGRATION_NAME = /^(\d{3})-[a-z0-9-]{1,80}\.sql$/;

async function readMigration(root, filename, version) {
  const path = resolve(root, filename);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_SQL_BYTES) {
    throw new Error(`Invalid migration file or size: ${filename}`);
  }
  const bytes = await Bun.file(path).arrayBuffer();
  if (bytes.byteLength !== stat.size) {
    throw new Error(`Migration changed while reading: ${filename}`);
  }
  const sql = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!sql.trim()) throw new Error(`Empty migration: ${filename}`);
  return {
    version,
    filename,
    sha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
    sql,
    bytes: bytes.byteLength,
  };
}

/** Only numbered PostgreSQL migrations; never descend into reference tables/ or data/. */
export async function readMigrations(sqlRoot = DEFAULT_SQL_ROOT) {
  const root = resolve(sqlRoot);
  const directory = await lstat(root);
  if (!directory.isDirectory()) {
    throw new Error("Migration root must be a directory");
  }
  const children = await readdir(root, { withFileTypes: true });
  if (children.length > MAX_MIGRATIONS * 2) {
    throw new Error("SQL root entry limit");
  }
  const entries = children.filter((entry) => entry.name.endsWith(".sql"));
  if (!entries.length || entries.length > MAX_MIGRATIONS) {
    throw new Error("Migration file count must be in 1..256");
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const migrations = [];
  let total = 0;
  for (const [index, entry] of entries.entries()) {
    const match = MIGRATION_NAME.exec(entry.name);
    if (!entry.isFile() || !match || Number(match[1]) !== index + 1) {
      throw new Error(
        `Migrations must be regular files numbered consecutively from 001: ${entry.name}`,
      );
    }
    const migration = await readMigration(root, entry.name, index + 1);
    total += migration.bytes;
    if (total > MAX_TOTAL_BYTES) {
      throw new Error("Migration aggregate byte limit");
    }
    migrations.push(migration);
  }
  return migrations;
}

function validateHistory(applied, migrations) {
  if (applied.length > migrations.length) {
    throw new Error(
      "Database contains migrations missing from the selected SQL root",
    );
  }
  for (const [index, row] of applied.entries()) {
    const source = migrations[index];
    if (
      row.version !== source.version ||
      row.filename !== source.filename ||
      row.sha256 !== source.sha256
    ) {
      throw new Error(
        `Applied migration changed or history is out of order: ${row.filename}`,
      );
    }
  }
}

/** Execute readMigrations() output in one locked transaction; failed runs roll back completely. */
export async function applyMigrations(sql, migrations) {
  if (!migrations.length || migrations.length > MAX_MIGRATIONS) {
    throw new Error("Migration count exceeds supported bounds");
  }
  return sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '15s'`;
    await tx`SET LOCAL statement_timeout = '60s'`;
    // Also serialize against the two former startup migration owners during upgrades.
    await tx`SELECT pg_advisory_xact_lock(742031091)`;
    await tx`SELECT pg_advisory_xact_lock(742031092)`;
    await tx`CREATE TABLE IF NOT EXISTS migrations (
      version integer PRIMARY KEY CHECK(version BETWEEN 1 AND 256),
      filename text NOT NULL UNIQUE,
      sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`;
    const applied =
      await tx`SELECT version,filename,sha256 FROM migrations ORDER BY version LIMIT ${MAX_MIGRATIONS + 1}`;
    validateHistory(applied, migrations);
    const pending = migrations.slice(applied.length);
    for (const migration of pending) {
      await tx.unsafe(migration.sql).simple();
      await tx`INSERT INTO migrations(version,filename,sha256) VALUES(${migration.version},${migration.filename},${migration.sha256})`;
    }
    return {
      schemaVersion: migrations.length,
      applied: pending.map((entry) => entry.filename),
      skipped: applied.map((entry) => entry.filename),
    };
  });
}
