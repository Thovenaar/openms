import { expect, test } from "bun:test";
import { SQL } from "bun";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrationOptions, migrateDatabase } from "../../tools/migrate.js";
import {
  readMigrations,
  applyMigrations,
} from "../../tools/database-migrations.js";
import { openDatabase } from "../src/database.js";
import { DATABASE_SCHEMA_VERSION } from "../src/database-schema.js";

const databaseUrl = process.env.OPENMS_TEST_DATABASE_URL;
const sqlRoot = process.env.OPENMS_TEST_SQL_ROOT;

test("migration CLI requires an explicit database and strict flags", () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://ignored/ignored";
  try {
    for (const args of [
      [],
      ["--database-url"],
      ["--database-url", "http://localhost/db"],
      ["--database-url", "postgres://localhost"],
      ["--wrong", "x"],
      [
        "--database-url",
        "postgres://localhost/db",
        "--database-url",
        "postgres://localhost/db",
      ],
    ]) {
      expect(() => migrationOptions(args)).toThrow();
    }
    expect(
      migrationOptions(["--database-url", "postgres://localhost/db"]),
    ).toMatchObject({ databaseUrl: "postgres://localhost/db" });
    expect(migrationOptions(["--help"])).toEqual({ help: true });
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("migration inventory only admits bounded consecutive PostgreSQL files", async () => {
  const root = await mkdtemp(join(tmpdir(), "openms-migration-files-"));
  try {
    await Bun.write(join(root, "001-first.sql"), "SELECT 1;");
    await Bun.write(
      join(root, "data/001-mysql.sql"),
      "invalid MySQL reference",
    );
    expect((await readMigrations(root)).map((file) => file.filename)).toEqual([
      "001-first.sql",
    ]);
    await Bun.write(join(root, "003-gap.sql"), "SELECT 3;");
    await expect(readMigrations(root)).rejects.toThrow("consecutively");
    await rm(join(root, "003-gap.sql"));
    await symlink(join(root, "data/001-mysql.sql"), join(root, "002-link.sql"));
    await expect(readMigrations(root)).rejects.toThrow("regular files");
    await rm(join(root, "002-link.sql"));
    await Bun.write(join(root, "002-large.sql"), " ".repeat(1024 * 1024 + 1));
    await expect(readMigrations(root)).rejects.toThrow("size");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("default migration inventory matches the runtime schema requirement", async () => {
  const migrations = await readMigrations();
  expect(migrations).toHaveLength(DATABASE_SCHEMA_VERSION);
  expect(migrations.at(-1).filename).toBe("007-content-kinds.sql");
});

async function withDatabase(run) {
  const name = `openms_migration_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new SQL(databaseUrl, { max: 1, connectionTimeout: 5 });
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  let created = false,
    sql;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`).simple();
    created = true;
    sql = new SQL(url.href, { max: 2, connectionTimeout: 5 });
    await run({ sql, url: url.href });
  } finally {
    await sql?.close({ timeout: 5 });
    try {
      if (created) {
        await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`).simple();
      }
    } finally {
      await admin.close({ timeout: 5 });
    }
  }
}

async function cliMigration(url) {
  const args = [
    process.execPath,
    "tools/openms.js",
    "migrate",
    "--database-url",
    url,
  ];
  if (sqlRoot) args.push("--sql-root", sqlRoot);
  const child = Bun.spawn(args, {
    cwd: new URL("../../", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error(`Migration CLI failed: ${stderr}`);
  return JSON.parse(stdout);
}

async function checkFreshDatabase({ sql, url }) {
  await expect(openDatabase({ url, items: {} })).rejects.toMatchObject({
    code: "MIGRATIONS_REQUIRED",
  });
  const empty =
    await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`;
  expect(empty[0].n).toBe(0);
  const first = await cliMigration(url);
  expect(first.applied).toHaveLength(7);
  expect(first.skipped).toHaveLength(0);
  await sql`INSERT INTO account(id,name,password_hash,role) VALUES('kept','kept','unused','player')`;
  const before =
    await sql`SELECT version,applied_at FROM migrations ORDER BY version`;
  const runtime = await openDatabase({ url, items: {} });
  await runtime.close();
  expect(
    await sql`SELECT version,applied_at FROM migrations ORDER BY version`,
  ).toEqual(before);
  const second = await cliMigration(url);
  expect(second.applied).toHaveLength(0);
  expect(second.skipped).toHaveLength(7);
  expect((await sql`SELECT name FROM account WHERE id='kept'`)[0].name).toBe(
    "kept",
  );
}

async function checkAtomicFailure({ sql, url }) {
  const migrations = await readMigrations(sqlRoot);
  const broken = [
    ...migrations,
    {
      version: 8,
      filename: "008-broken.sql",
      sha256: "a".repeat(64),
      sql: "CREATE TABLE rollback_probe(id integer); SELECT * FROM missing_migration_table;",
    },
  ];
  await expect(applyMigrations(sql, broken)).rejects.toThrow();
  const empty =
    await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`;
  expect(empty[0].n).toBe(0);
  await applyMigrations(sql, migrations.slice(0, -1));
  await expect(openDatabase({ url, items: {} })).rejects.toMatchObject({
    code: "MIGRATIONS_REQUIRED",
  });
  await applyMigrations(sql, migrations);
  const changed = migrations.map((file, index) =>
    index ? file : { ...file, sha256: "b".repeat(64) },
  );
  await expect(applyMigrations(sql, changed)).rejects.toThrow(
    "Applied migration changed",
  );
  expect((await sql`SELECT count(*)::int AS n FROM migrations`)[0].n).toBe(7);
}

async function checkLegacyDatabase({ sql, url }) {
  const migrations = await readMigrations(sqlRoot);
  // Reproduce the former startup runner without the new migration ledger.
  for (const migration of migrations) await sql.unsafe(migration.sql).simple();
  await sql`INSERT INTO account(id,name,password_hash,role) VALUES('legacy','legacy','unused','player')`;
  const runs = await Promise.all([
    migrateDatabase({ databaseUrl: url, sqlRoot }),
    migrateDatabase({ databaseUrl: url, sqlRoot }),
  ]);
  expect(runs.flatMap((run) => run.applied)).toHaveLength(7);
  expect(runs.flatMap((run) => run.skipped)).toHaveLength(7);
  expect((await sql`SELECT name FROM account WHERE id='legacy'`)[0].name).toBe(
    "legacy",
  );
  const triggers =
    await sql`SELECT tgname FROM pg_trigger WHERE tgname='character_snapshot_immutable'`;
  expect(triggers).toHaveLength(0);
}

test.skipIf(!databaseUrl)(
  "explicit CLI migration initializes once; startup never writes the schema",
  () => withDatabase(checkFreshDatabase),
  30000,
);
test.skipIf(!databaseUrl)(
  "failed migrations roll back and changed applied scripts are refused",
  () => withDatabase(checkAtomicFailure),
  30000,
);
test.skipIf(!databaseUrl)(
  "legacy schema adoption preserves data and concurrent reruns are safe",
  () => withDatabase(checkLegacyDatabase),
  30000,
);
