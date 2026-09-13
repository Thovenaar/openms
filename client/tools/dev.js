import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareRelease } from "./release-manifest.js";
import { buildBrowser } from "./browser-build.js";
import { measureStage } from "./native-evidence.js";
import { createStaticResources } from "./static-resources.js";
import { clientEnvironment } from "./environment.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Percent counts four completed startup stages, not estimated duration or discovered assets. */
function startupProgress(sink) {
  const started = performance.now();
  let completed = 0;
  return {
    line(message) {
      sink?.(
        `[${completed * 25}% +${((performance.now() - started) / 1000).toFixed(2)}s] ${message}`,
      );
    },
    complete(message) {
      completed++;
      this.line(message);
    },
  };
}
async function compileDevelopment(state) {
  const started = performance.now();
  const timings = {};
  const progress = startupProgress(state.progress);
  state.startup = progress;
  progress.line(
    "Starting: browser build, release verification, HTTP encoding, listener (4 stages)",
  );
  const build = await measureStage(timings, "browserBuildMs", () =>
    buildBrowser(progress.line),
  );
  progress.complete(
    `Browser build complete (${timings.browserBuildMs.toFixed(1)}ms)`,
  );
  const release = await measureStage(timings, "releaseMs", () =>
    prepareRelease(root, progress.line, timings),
  );
  progress.complete(`Release complete (${timings.releaseMs.toFixed(1)}ms)`);
  const resources = createStaticResources({ root });
  const encodings = await measureStage(timings, "httpEncodingMs", () =>
    resources.prepare(release.resources),
  );
  progress.complete(
    `HTTP encoding complete (${encodings.size} resources; ${timings.httpEncodingMs.toFixed(1)}ms)`,
  );
  state.resources = resources;
  state.identity = {
    sourceBuildId: build.sourceBuildId,
    assetBuildId: release.buildId,
    releaseId: release.releaseId,
    elapsedMs: performance.now() - started,
    timings: { ...build.timings, ...timings },
  };
  progress.line(
    `Offline release ${release.releaseId}: ${release.resources.length} resources, ${release.totalBytes} bytes, ${release.maps.length} maps`,
  );
  return { ...state.identity };
}

async function rebuildDevelopment(state) {
  if (state.pending) return state.pending;
  state.pending = compileDevelopment(state);
  try {
    const identity = await state.pending;
    if (state.listening) {
      state.startup.complete("Rebuilt client ready on the owned listener");
    }
    return identity;
  } finally {
    state.pending = null;
  }
}

/** One owned server; optional synchronous progress keeps programmatic callers quiet. */
export async function startDevServer(options = {}) {
  const hostname = options.hostname ?? clientEnvironment.HOST ?? "127.0.0.1";
  if (typeof hostname !== "string" || !hostname.trim()) {
    throw new Error("HOST must be a non-empty hostname or IP address");
  }
  const port = Number(options.port ?? clientEnvironment.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  const state = {
    resources: null,
    identity: null,
    pending: null,
    progress: options.progress,
  };
  await rebuildDevelopment(state);
  const listeningAt = performance.now();
  const server = Bun.serve({
    hostname,
    port,
    fetch: (request) => state.resources.fetch(request),
  });
  state.identity.timings.listenerMs = performance.now() - listeningAt;
  state.identity.elapsedMs += state.identity.timings.listenerMs;
  state.listening = true;
  state.startup.complete(`openms.dev offline client ready at ${server.url}`);
  return {
    server,
    rebuild: () => rebuildDevelopment(state),
    identity: () => ({ ...state.identity }),
  };
}

if (import.meta.main) {
  await startDevServer({ progress: (message) => console.log(message) });
}
