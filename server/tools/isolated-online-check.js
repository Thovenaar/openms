import { SQL } from "bun";
import { acquireBrowser } from "../../client/tools/native-scenario-runner.js";
import { loadEnvironment } from "../../shared/environment.js";
import { serverConfig } from "../src/config.js";
import { loadContent } from "../src/content.js";
import { openDatabase } from "../src/database.js";
import { startServer } from "../src/index.js";
import { startOnlineDevServer } from "../../client/tools/dev-online.js";
import { startStudioServer } from "../../studio/tools/dev.js";

/** Disposable database and listeners; never reset the configured development database. */
export async function isolatedOnlineCheck({
  seed,
  run,
  output,
  studio = false,
}) {
  const environment = loadEnvironment("server");
  const name = `openms_check_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new SQL(environment.DATABASE_URL, { max: 1 });
  const owner = {
    admin,
    name,
    created: false,
    runtime: null,
    client: null,
    studio: null,
    browser: null,
  };
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    owner.created = true;
    const url = new URL(environment.DATABASE_URL);
    url.pathname = `/${name}`;
    const config = serverConfig({
      ...environment,
      DATABASE_URL: url.href,
      OPENMS_MODE: "development",
      OPENMS_PORT: "3297",
      OPENMS_ORIGIN: "http://127.0.0.1:3197",
      OPENMS_STUDIO_ORIGIN: studio ? "http://127.0.0.1:3198" : "",
    });
    const content = await loadContent();
    const database = await openDatabase({
      url: url.href,
      items: content.items,
    });
    try {
      await seed(database, content);
    } catch (error) {
      await database.close();
      throw error;
    }
    owner.runtime = await startServer({ config, content, database });
    await startFrontends(owner, config);
    owner.browser = await launchBrowser();
    const restart = async () => {
      await owner.runtime.close();
      owner.runtime = await startServer({ config, content });
    };
    return await run({
      browser: owner.browser,
      url: config.origin,
      studioUrl: config.studioOrigin,
      output,
      restart,
    });
  } finally {
    await release(owner);
  }
}

async function startFrontends(owner, config) {
  owner.client = await startOnlineDevServer({
    port: 3197,
    upstream: "http://127.0.0.1:3297",
  });
  if (config.studioOrigin) {
    owner.studio = await startStudioServer({
      hostname: "127.0.0.1",
      port: 3198,
      upstream: "http://127.0.0.1:3297",
      clientUrl: config.origin,
      contentRoot: config.contentRoot,
    });
  }
}

async function release(owner) {
  const results = await Promise.allSettled([
    closeResource("browser", () => owner.browser?.close()),
    closeResource("client", () => owner.client?.close()),
    closeResource("studio", () => owner.studio?.close()),
    closeResource(
      "runtime",
      () => owner.runtime?.close(),
      () => ({
        worldClosed: owner.runtime?.world.closed,
        pendingRequests: owner.runtime?.server.pendingRequests,
        pendingWebSockets: owner.runtime?.server.pendingWebSockets,
      }),
    ),
  ]);
  try {
    if (owner.created) {
      await owner.admin.unsafe(`DROP DATABASE "${owner.name}" WITH (FORCE)`);
    }
  } finally {
    await owner.admin.close();
  }
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}

/** A failed fixture must still drop its disposable database and exit within a bound. */
async function closeResource(label, close, diagnostic = () => null) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Online fixture ${label} cleanup timed out: ${JSON.stringify(diagnostic())}`,
        ),
      );
    }, 10000);
  });
  try {
    await Promise.race([close(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function launchBrowser() {
  return (await acquireBrowser({})).browser;
}
