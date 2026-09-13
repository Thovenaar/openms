import { loadEnvironment } from "../../shared/environment.js";

const environment = loadEnvironment("server");
const databaseUrl =
  process.env.OPENMS_TEST_DATABASE_URL ?? environment.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "Configure DATABASE_URL or OPENMS_TEST_DATABASE_URL for disposable content checks",
  );
}
const child = Bun.spawn(
  [
    process.execPath,
    "test",
    "content/test",
    "server/test/content-http.test.js",
    "server/test/development-http.test.js",
    "server/test/world-content.test.js",
  ],
  {
    cwd: new URL("../../", import.meta.url).pathname,
    env: { ...process.env, OPENMS_TEST_DATABASE_URL: databaseUrl },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exitCode = await child.exited;
