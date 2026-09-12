import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { loadEnvironment } from "../../shared/environment.js";
import { serverConfig } from "../src/config.js";
import { loadContent } from "../src/content.js";
import { openDatabase } from "../src/database.js";
import { startServer } from "../src/index.js";

/** Reset only dedicated development accounts, keeping their existing characters. */
async function bootstrap(database, content, environment) {
  const manifest = await content.map(content.catalog.defaultMap);
  const arrival = nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 });
  const credentials = [];
  for (const role of ["developer", "player"]) {
    const name = `dev_${role}`;
    const password = environment.OPENMS_DEV_PASSWORD ?? crypto.randomUUID();
    const passwordHash = await Bun.password.hash(password, {
      algorithm: "argon2id",
    });
    let account = await database.accountByName(name);
    if (account) {
      if (account.role !== role) {
        throw new Error(`Refusing to replace unrelated ${name} account role`);
      }
      await database.sql`UPDATE account SET password_hash=${passwordHash} WHERE id=${account.id}`;
    } else account = await database.createAccount({ name, passwordHash, role });
    if (!(await database.listCharacters(account.id)).length) {
      const profile = createProfile({
        mapId: manifest.id,
        x: arrival.x,
        y: arrival.y,
        facing: arrival.facing ?? 1,
      });
      profile.name = role === "developer" ? "Developer" : "Player";
      await database.createCharacter(account.id, profile);
    }
    credentials.push({ name, password });
  }
  return credentials;
}

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
    const content = await loadContent({ root: config.contentRoot });
    database = await openDatabase({
      url: config.databaseUrl,
      items: content.items,
    });
    const credentials = await bootstrap(database, content, environment);
    runtime = await startServer({ config, content, database });
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
await main();
