import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { join } from "node:path";
import {
  boundedResponse,
  resourceByteLimit,
} from "../public/offline-manifest.js";

const READY_PREFIX = "MAPLE_SMOKE_READY ";
const READY_TIMEOUT_MS = 120000;
const MAX_LOG_BYTES = 16 * 1024 * 1024;

async function consumeOutput(owner, ready) {
  const lines = createInterface({
    input: Readable.fromWeb(owner.child.stdout),
    crlfDelay: Infinity,
  });
  const sink = Bun.file(owner.log).writer();
  let bytes = 0;
  try {
    for await (const line of lines) {
      bytes += Buffer.byteLength(line) + 1;
      if (bytes > MAX_LOG_BYTES) {
        throw new Error(`Dev output exceeds limit: ${owner.log}`);
      }
      sink.write(`${line}\n`);
      if (line.startsWith(READY_PREFIX)) {
        ready.resolve(JSON.parse(line.slice(READY_PREFIX.length)));
      }
    }
  } catch (error) {
    owner.failure = error.message;
    ready.reject(error);
    owner.child.kill("SIGKILL");
  } finally {
    await sink.end();
    lines.close();
  }
}

export async function stopOwnedServer(session) {
  const owner = session.dev;
  if (!owner) return;
  owner.child.kill("SIGTERM");
  const timer = setTimeout(() => owner.child.kill("SIGKILL"), 2000);
  session.dev = null;
  try {
    await owner.child.exited;
    await owner.output;
  } finally {
    clearTimeout(timer);
    session.children.delete(owner.child);
  }
}
async function verifyReady(identity, url) {
  for (const name of ["sourceBuildId", "assetBuildId", "releaseId"]) {
    if (!/^[a-f0-9]{64}$/.test(identity?.[name])) {
      throw new Error(`Dev readiness has invalid ${name}`);
    }
  }
  const response = await fetch(new URL("/generated/catalog.json", url), {
    redirect: "error",
    signal: AbortSignal.timeout(READY_TIMEOUT_MS),
  });
  const bytes = await boundedResponse(
    response,
    resourceByteLimit("/generated/catalog.json"),
  );
  const catalog = JSON.parse(new TextDecoder().decode(bytes));
  if (catalog.buildId !== identity.assetBuildId) {
    throw new Error("Owned dev server serves a mismatched catalog identity");
  }
  return identity;
}

/** Restart only this session's verified child; wait for exit before rebinding its port. */
export async function rebuildOwnedServer(session, output) {
  await stopOwnedServer(session);
  if (session.stopping) throw new Error("Smoke session cancelled");
  const ready = Promise.withResolvers();
  const child = Bun.spawn(
    [
      process.execPath,
      "client/tools/smoke-server.js",
      String(session.options.port),
    ],
    {
      cwd: session.options.repository,
      stdout: "pipe",
      stderr: Bun.file(join(output, "dev.stderr.log")),
      env: {
        ...process.env,
        MAPLE_ASSETS: session.options.assets,
        MAPLE_SERVER_REFERENCE: session.options.serverReference,
      },
    },
  );
  const owner = { child, log: join(output, "dev.stdout.log") };
  session.dev = owner;
  session.children.add(child);
  owner.output = consumeOutput(owner, ready).catch((error) => {
    ready.reject(error);
    owner.failure = error.message;
    child.kill("SIGKILL");
  });
  const timer = setTimeout(
    () =>
      ready.reject(new Error(`Dev readiness timed out; inspect ${owner.log}`)),
    READY_TIMEOUT_MS,
  );
  child.exited.then((code) => {
    owner.exited = true;
    ready.reject(
      new Error(`Owned dev server exited ${code}; inspect ${owner.log}`),
    );
  });
  try {
    owner.identity = await verifyReady(
      await ready.promise,
      session.options.url,
    );
    if (owner.failure || owner.exited) {
      throw new Error(
        owner.failure ?? "Owned dev server exited during readiness",
      );
    }
    return owner.identity;
  } catch (error) {
    await stopOwnedServer(session);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

if (import.meta.main) {
  const { startDevServer } = await import("./dev.js");
  const dev = await startDevServer({
    hostname: "127.0.0.1",
    port: Number(process.argv[2]),
    progress: (line) => console.log(line),
  });
  const stop = () => {
    dev.server.stop(true);
    process.exitCode = 0;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(READY_PREFIX + JSON.stringify(dev.identity()));
}
