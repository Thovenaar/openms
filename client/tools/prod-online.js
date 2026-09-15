import { startOnlineDevServer } from "./dev-online.js";

// Build once, then serve the production site and the existing generated asset store.
const runtime = await startOnlineDevServer({ production: true });
process.once("SIGINT", runtime.close);
process.once("SIGTERM", runtime.close);
