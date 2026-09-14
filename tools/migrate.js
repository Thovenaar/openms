import { SQL } from "bun";
import { resolve } from "node:path";
import { parseFlags } from "../client/tools/source-options.js";
import {
  readMigrations,
  applyMigrations,
  DEFAULT_SQL_ROOT,
} from "./database-migrations.js";

export function migrationOptions(args) {
  const values = parseFlags(args, {
    "database-url": { type: "string" },
    "sql-root": { type: "string", default: DEFAULT_SQL_ROOT },
    help: { type: "boolean", default: false },
  });
  if (values.help) return { help: true };
  return {
    databaseUrl: databaseUrl(values["database-url"]),
    sqlRoot: resolve(values["sql-root"]),
  };
}

function databaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--database-url must name a PostgreSQL database");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2 ||
    url.hash
  ) {
    throw new Error("--database-url must name a PostgreSQL database");
  }
  return url.href;
}

/** Explicit inputs only; no .env files, ambient DATABASE_URL, assets or running server required. */
export async function migrateDatabase(options) {
  const url = databaseUrl(options.databaseUrl);
  const migrations = await readMigrations(options.sqlRoot);
  const sql = new SQL(url, { max: 1, connectionTimeout: 10, idleTimeout: 5 });
  try {
    return await applyMigrations(sql, migrations);
  } finally {
    await sql.close({ timeout: 5 });
  }
}

if (import.meta.main) {
  try {
    const options = migrationOptions(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Usage: bun run migrate --database-url URL [--sql-root DIR]\nApplies numbered PostgreSQL scripts from DIR in order. Default DIR: repository infra/sql.\nRequires an existing database. Does not read .env files or environment configuration.\nRecords filenames and SHA-256 in PostgreSQL migrations; unchanged applied scripts are skipped. No assets or account seeding.",
      );
    } else console.log(JSON.stringify(await migrateDatabase(options), null, 2));
  } catch (error) {
    console.error(`migrate: ${error.message}`);
    process.exitCode = 1;
  }
}
