import { migrationOptions } from "../../tools/migrate.js";

/** The explicit target is used only to create/drop disposable databases for the test worker. */
const options = migrationOptions(process.argv.slice(2));
if (options.help) {
  console.log(
    "Usage: bun server/tools/check-migrations.js --database-url URL [--sql-root DIR]\nChecks migrations in disposable databases; never migrates the supplied database.",
  );
} else {
  const child = Bun.spawn(
    [process.execPath, "test", "server/test/migrations.test.js"],
    {
      cwd: new URL("../../", import.meta.url).pathname,
      env: {
        ...process.env,
        OPENMS_TEST_DATABASE_URL: options.databaseUrl,
        OPENMS_TEST_SQL_ROOT: options.sqlRoot,
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  process.exitCode = await child.exited;
}
