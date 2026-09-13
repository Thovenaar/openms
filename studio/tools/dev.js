import { studioConfig } from "./config.js";
import { createStudioHttp } from "./http.js";

/** Studio owns this listener, its browser build and static cache; the game client is independent. */
export async function startStudioServer(options = {}) {
  const config = studioConfig(options);
  const handler = await createStudioHttp(config);
  const server = Bun.serve({
    hostname: config.hostname,
    port: config.port,
    maxRequestBodySize: 4 * 1024 * 1024,
    fetch: handler,
  });
  console.log(`OpenMS Studio ready at ${server.url}; API ${config.upstream}`);
  return { server, close: () => server.stop(true) };
}

if (import.meta.main) {
  const runtime = await startStudioServer();
  process.once("SIGINT", runtime.close);
  process.once("SIGTERM", runtime.close);
}
