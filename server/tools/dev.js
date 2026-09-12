import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SQL } from "bun";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE = resolve(ROOT, "server/.cache/postgres");
const MAX_START_ATTEMPTS = 100;

function executable(name) {
  const explicit = process.env.OPENMS_PG_BIN;
  const locations = explicit
    ? [resolve(explicit, name)]
    : [
        name,
        `/opt/homebrew/opt/postgresql@17/bin/${name}`,
        `/opt/homebrew/opt/postgresql@16/bin/${name}`,
        `/opt/homebrew/bin/${name}`,
        `/usr/local/bin/${name}`,
      ];
  for (const location of locations) {
    const found = Bun.which(location);
    if (found) return found;
  }
  throw new Error(
    `PostgreSQL ${name} is required. Install PostgreSQL or set DATABASE_URL / OPENMS_PG_BIN.`,
  );
}
async function run(command) {
  const child = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command[0]} exited ${code}`);
}
async function claimLauncher() {
  const path = resolve(CACHE, "launcher.lock");
  try {
    const lock = await open(path, "wx", 0o600);
    await lock.writeFile(String(process.pid));
    await lock.close();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(await readFile(path, "utf8"));
    if (!Number.isSafeInteger(pid) || pid < 1) {
      throw new Error(
        "Invalid PostgreSQL launcher lock; inspect server/.cache/postgres/launcher.lock",
      );
    }
    try {
      process.kill(pid, 0);
    } catch (probe) {
      if (probe.code !== "ESRCH") throw probe;
      await unlink(path);
      const lock = await open(path, "wx", 0o600);
      await lock.writeFile(String(process.pid));
      await lock.close();
      return path;
    }
    throw new Error("Owned PostgreSQL launcher is already running");
  }
  return path;
}
/** Initialize the private cluster once, retaining its existing credentials on restart. */
async function preparePostgresData(data) {
  const passwordFile = resolve(CACHE, "password");
  if (await Bun.file(resolve(data, "PG_VERSION")).exists()) {
    return (await readFile(passwordFile, "utf8")).trim();
  }
  const password = crypto.randomUUID() + crypto.randomUUID();
  const file = await open(passwordFile, "w", 0o600);
  await file.writeFile(password + "\n");
  await file.close();
  await run([
    executable("initdb"),
    "-D",
    data,
    "-U",
    "openms",
    "--auth=scram-sha-256",
    `--pwfile=${passwordFile}`,
    "--encoding=UTF8",
    "--no-locale",
  ]);
  return password;
}

async function ownedPostgres() {
  await mkdir(CACHE, { recursive: true, mode: 0o700 });
  const lock = await claimLauncher();
  let child = null;
  try {
    const data = resolve(CACHE, "data");
    const password = await preparePostgresData(data);
    const port = Number(process.env.OPENMS_PG_PORT ?? 55432);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error("Invalid OPENMS_PG_PORT");
    }
    const url = `postgres://openms:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`;
    child = Bun.spawn(
      [
        executable("postgres"),
        "-D",
        data,
        "-h",
        "127.0.0.1",
        "-p",
        String(port),
        "-k",
        CACHE,
      ],
      { stdin: "ignore", stdout: "inherit", stderr: "inherit" },
    );
    await waitPostgres(child, url);
    return {
      url,
      async close() {
        child.kill("SIGINT");
        await child.exited;
        await unlink(lock);
      },
    };
  } catch (error) {
    if (child) {
      child.kill("SIGINT");
      await child.exited;
    }
    await unlink(lock);
    throw error;
  }
}
async function waitPostgres(child, url) {
  let lastError;
  for (let attempt = 0; attempt < MAX_START_ATTEMPTS; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error("Owned PostgreSQL exited before readiness");
    }
    const sql = new SQL(url, { max: 1, connectionTimeout: 1 });
    try {
      const rows =
        await sql`SELECT current_setting('data_directory') AS directory`;
      if (resolve(rows[0].directory) !== resolve(CACHE, "data")) {
        throw new Error("PostgreSQL port belongs to another cluster");
      }
      const pid = Number(
        (await readFile(resolve(CACHE, "data/postmaster.pid"), "utf8")).split(
          "\n",
          1,
        )[0],
      );
      if (pid !== child.pid) {
        throw new Error("PostgreSQL readiness belongs to another process");
      }
      return;
    } catch (error) {
      lastError = error;
    } finally {
      await sql.close();
    }
    await Bun.sleep(100);
  }
  throw new Error("Owned PostgreSQL readiness timed out", { cause: lastError });
}
async function bootstrap(database, content) {
  const manifest = await content.map(content.catalog.defaultMap);
  const arrival = nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 });
  const credentials = [];
  for (const role of ["developer", "player"]) {
    const name = `dev_${role}`;
    const password = process.env.OPENMS_DEV_PASSWORD ?? crypto.randomUUID();
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
  process.env.OPENMS_MODE = "development";
  let owned = null;
  let runtime = null;
  let database = null;
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    try {
      if (runtime) await runtime.close();
      else if (database) await database.close();
    } finally {
      if (owned) await owned.close();
    }
  }
  try {
    if (!process.env.DATABASE_URL) {
      owned = await ownedPostgres();
      process.env.DATABASE_URL = owned.url;
    }
    const { serverConfig } = await import("../src/config.js");
    const { loadContent } = await import("../src/content.js");
    const { openDatabase } = await import("../src/database.js");
    const { startServer } = await import("../src/index.js");
    const config = serverConfig();
    const content = await loadContent({ root: config.contentRoot });
    database = await openDatabase({
      url: config.databaseUrl,
      items: content.items,
    });
    const credentials = await bootstrap(database, content);
    runtime = await startServer({ config, content, database });
    console.log(
      "Development-only accounts (passwords reset on each launcher start):",
    );
    for (const credential of credentials) {
      console.log(`  ${credential.name}: ${credential.password}`);
    }
    if (process.env.OPENMS_DEV_PASSWORD) {
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
