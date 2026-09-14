/** Bump when a new migration changes the schema required by this runtime. */
export const DATABASE_SCHEMA_VERSION = 6;

function migrationRequired() {
  return Object.assign(
    new Error(
      "Database schema is missing or incompatible. Run bun run migrate --database-url URL before starting the server.",
    ),
    { code: "MIGRATIONS_REQUIRED" },
  );
}

/** Startup is read-only: no schema creation, migration replay or migration bookkeeping. */
export async function assertDatabaseSchema(sql) {
  const tables =
    await sql`SELECT to_regclass('migrations') IS NOT NULL AS present`;
  if (!tables[0]?.present) throw migrationRequired();
  const rows =
    await sql`SELECT version FROM migrations ORDER BY version LIMIT ${DATABASE_SCHEMA_VERSION + 1}`;
  if (
    rows.length !== DATABASE_SCHEMA_VERSION ||
    rows.some((row, index) => row.version !== index + 1)
  ) {
    throw migrationRequired();
  }
}
