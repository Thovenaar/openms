import { serverConfig } from "./config.js";
import { loadContent } from "./content.js";
import { openDatabase } from "./database.js";
import { OnlineWorld } from "./world.js";
import { SessionAuthority } from "./auth.js";
import { GameplayGateway } from "./gateway.js";
import { OnlineHttp } from "./http.js";

/** One owned field process; TLS terminates at the configured same-origin reverse proxy. */
export async function startServer(options = {}) {
  const started = performance.now();
  const config = options.config ?? serverConfig();
  const content =
    options.content ?? (await loadContent({ root: config.contentRoot }));
  if (
    config.expectedRulesHash &&
    config.expectedRulesHash !== content.rulesHash
  ) {
    throw new Error("Verified server rules do not match OPENMS_RULES_HASH");
  }
  const database =
    options.database ??
    (await openDatabase({ url: config.databaseUrl, items: content.items }));
  const auth = new SessionAuthority(config, database, content);
  const world = new OnlineWorld({
    content,
    database,
    development: config.development,
    publish: (actor, record) => gateway.publications.publish(actor, record),
  });
  const gateway = new GameplayGateway({ config, auth, database, world });
  const http = new OnlineHttp({ config, content, auth, gateway });
  let server;
  try {
    server = Bun.serve({
      hostname: config.hostname,
      port: config.port,
      maxRequestBodySize: 16 * 1024,
      idleTimeout: 10,
      fetch: http.fetch.bind(http),
      websocket: gateway.handlers,
    });
  } catch (error) {
    await database.close();
    throw error;
  }
  const lifecycle = createLifecycle({ server, world, gateway, database });
  console.log(
    `openms.dev authoritative server ready at ${server.url} (${(performance.now() - started).toFixed(1)}ms)`,
  );
  console.log(
    `Rules ${content.rulesHash}; assets ${content.assetBuildId}; ${config.development ? "loopback development" : "production"}`,
  );
  return {
    server,
    world,
    gateway,
    auth,
    database,
    content,
    config,
    close: lifecycle.close,
  };
}

function createLifecycle({ server, world, gateway, database }) {
  let stopped = false;
  let closing = null;
  const timer = setInterval(tick, 10);
  function tick() {
    if (stopped) return;
    try {
      world.step(performance.now());
      gateway.maintain(Date.now());
    } catch (error) {
      stopped = true;
      clearInterval(timer);
      console.error("Authoritative simulation suspended:", error.message);
      for (const socket of gateway.sockets) {
        gateway.publications.close(socket, "SERVER_BUSY");
      }
    }
  }
  async function finish() {
    stopped = true;
    clearInterval(timer);
    await gateway.close();
    await world.close();
    await server.stop(true);
    await database.close();
  }
  function close() {
    closing ??= finish();
    return closing;
  }
  return { close };
}

if (import.meta.main) {
  const runtime = await startServer();
  async function shutdown() {
    try {
      await runtime.close();
    } catch (error) {
      console.error("Server shutdown failed:", error.message);
      process.exitCode = 1;
    }
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
