import { loadEnvironment } from "../../shared/environment.js";
import { serverConfig } from "../src/config.js";
import { loadContent } from "../src/content.js";
import { openDatabase } from "../src/database.js";
import { startServer } from "../src/index.js";
import { bootstrapDevelopmentAccounts } from "./development-accounts.js";
import {
  createDevelopmentLog,
  logStage,
} from "../../shared/development-log.js";

async function main() {
  const environment = loadEnvironment("server");
  if (
    environment.OPENMS_MODE === "production" ||
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      "The development launcher cannot run in production; use server/src/index.js",
    );
  }
  const config = serverConfig({ ...environment, OPENMS_MODE: "development" });
  const log = createDevelopmentLog("server");
  log("development.start", {
    hostname: config.hostname,
    port: config.port,
    origin: config.origin,
  });
  let runtime = null;
  let database = null;
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    if (runtime) await runtime.close();
    else if (database) await database.close();
  }
  try {
    const content = await logStage(log, "content.load", () =>
      loadContent({ root: config.contentRoot }),
    );
    database = await logStage(log, "database.connect-and-migrate", () =>
      openDatabase({
        url: config.databaseUrl,
        items: content.items,
      }),
    );
    const credentials = await logStage(log, "development.bootstrap", () =>
      bootstrapDevelopmentAccounts(database, content, environment),
    );
    runtime = await startServer({ config, content, database, log });
    printCredentials(credentials, environment);
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => {
        shutdown().then(
          () => process.exit(0),
          (error) => {
            console.error(error);
            process.exit(1);
          },
        );
      });
    }
  } catch (error) {
    await shutdown();
    throw error;
  }
}

function printCredentials(credentials, environment) {
  console.log(
    "Development-only accounts (passwords reset on each launcher start):",
  );
  for (const credential of credentials) {
    console.log(`  ${credential.name}: ${credential.password}`);
  }
  if (environment.OPENMS_DEV_PASSWORD) {
    console.log(
      "OPENMS_DEV_PASSWORD override applies to both development accounts.",
    );
  }
}
await main();
