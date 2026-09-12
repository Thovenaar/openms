import puppeteer from "puppeteer-core";
import { parseArgs } from "node:util";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { rebuildOwnedServer, stopOwnedServer } from "./smoke-server.js";
import { inputRoots, scanInputs, selectAffected } from "./smoke-inputs.js";
import { loadScenarios, readJSON, runJob, writeStatus } from "./smoke-jobs.js";
import { measureStage } from "./native-evidence.js";
import { scenarioConcurrency } from "./native-scenario-runner.js";
import {
  inspectExtractedAssets,
  rememberExtractedAssets,
} from "./smoke-assets.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const POLL_MS = 1000;
const COALESCE_MS = 200;
const DEFAULT_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function optionsFor(args) {
  const { values } = parseArgs({
    args,
    options: {
      once: { type: "boolean", default: false },
      scenarios: { type: "string" },
      url: { type: "string" },
      port: { type: "string", default: "3101" },
      output: { type: "string", default: "artifacts/smoke" },
      chrome: { type: "string", default: DEFAULT_CHROME },
      concurrency: { type: "string", default: "1" },
      assets: { type: "string" },
      "server-reference": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  const { port, url } = ownedServerOptions(values);
  const scenarios = values.scenarios ? values.scenarios.split(",") : [];
  if (scenarios.length > 64 || new Set(scenarios).size !== scenarios.length) {
    throw new Error("Duplicate or excessive scenario selection");
  }
  return {
    ...values,
    repository,
    concurrency: scenarioConcurrency(values.concurrency),
    port,
    url: url.href,
    scenarios,
    assets: resolve(
      values.assets ??
        Bun.env.MAPLE_ASSETS ??
        "/Users/k/Development/tensorfish/Maplestory-Client",
    ),
    serverReference: resolve(
      values["server-reference"] ??
        Bun.env.MAPLE_SERVER_REFERENCE ??
        "/Users/k/Development/tensorfish/Cosmic",
    ),
  };
}

function ownedServerOptions(values) {
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer from 1 to 65535");
  }
  const url = new URL(values.url ?? `http://127.0.0.1:${port}`);
  if (
    url.origin !== `http://127.0.0.1:${port}` ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "--url must point to the owned server: http://127.0.0.1:<port>/",
    );
  }
  return { port, url };
}

async function checkChanges(session) {
  const scanned = await scanInputs(session.roots, session.inputs);
  session.inputs = scanned.next;
  if (!scanned.changed.length) {
    if (!session.stopping && session.dev?.exited) {
      throw new Error(
        `Owned dev server exited; inspect ${session.dev.log}; edit an input or send SIGUSR1 to rebuild.`,
      );
    }
    return;
  }
  for (const path of scanned.changed) session.pending.add(path);
  session.generation++;
  session.changedAt = Date.now();
  await writeStatus(session, {
    status: "pending",
    reason: "input-content-changed",
    changes: [...session.pending],
  });
}

function scheduleScan(session) {
  if (session.stopping) return;
  session.timer = setTimeout(async () => {
    try {
      session.scan = checkChanges(session);
      await session.scan;
      session.scanFailure = null;
    } catch (error) {
      session.scanFailure = error.message;
      await writeStatus(session, {
        status: "fail",
        phase: "watch",
        failure: error.message,
      });
    } finally {
      session.scan = null;
      session.wake?.();
      scheduleScan(session);
    }
  }, POLL_MS);
}

async function refreshAssets(session, output) {
  await runJob(session, {
    label: "extract",
    output,
    args: [
      "client/tools/extract.js",
      "--preflight-report",
      join(output, "preflight.json"),
    ],
  });
}

async function prepareRuntime(session, output, timings) {
  const inputs = new Map(session.inputs);
  const assets = await measureStage(timings, "assetProbeMs", () =>
    inspectExtractedAssets(session.options, inputs),
  );
  timings.assetReuse = assets.reason;
  if (!assets.reusable) {
    await measureStage(timings, "assetRefreshMs", () =>
      refreshAssets(session, output),
    );
    const rechecked = await measureStage(timings, "assetInputRecheckMs", () =>
      scanInputs(session.roots, inputs),
    );
    if (rechecked.changed.length) {
      throw new Error(
        "Inputs changed during extraction; refusing reuse receipt",
      );
    }
    await rememberExtractedAssets(session.options, inputs, assets);
  }
  const identity = await measureStage(timings, "serverStartupMs", () =>
    rebuildOwnedServer(session, output),
  );
  if (session.stopping) throw new Error("Smoke session cancelled");
  timings.browserReused = Boolean(session.browser);
  if (!session.browser) {
    session.browser = await measureStage(timings, "browserAcquireMs", () =>
      puppeteer.launch({
        executablePath: session.options.chrome,
        headless: true,
        args: [
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
        ],
      }),
    );
  }
  return identity;
}

async function nativeGeneration(session, run) {
  const descriptors = await loadScenarios(session, run.output);
  session.roots = inputRoots(session.options, descriptors);
  const selected =
    run.changes.includes("startup") || run.changes.includes("manual-rerun")
      ? {
          names: descriptors.map((entry) => entry.name),
          reasons: [{ reason: run.changes[0] }],
        }
      : selectAffected(descriptors, run.changes);
  const identity = await prepareRuntime(session, run.output, run.timings);
  await writeFile(
    join(run.output, "generation.json"),
    JSON.stringify({ ...run, ...selected, identity }, null, 2),
  );
  if (session.generation !== run.id) {
    return { status: "superseded", identity, ...selected };
  }
  await runJob(session, {
    label: "native",
    output: run.output,
    args: [
      "client/tools/native-scenarios.js",
      ...selected.names,
      "--url",
      session.options.url,
      "--output",
      run.output,
      "--concurrency",
      String(session.options.concurrency),
      "--browserWSEndpoint",
      session.browser.wsEndpoint(),
    ],
  });
  const report = await readJSON(join(run.output, "report.json"));
  if (
    report.status !== "pass" ||
    report.identities?.sourceBuildId !== identity.sourceBuildId ||
    report.identities?.assetBuildId !== identity.assetBuildId
  ) {
    throw new Error(
      `Native result failed or mismatched build identity; inspect ${join(run.output, "report.json")}`,
    );
  }
  return {
    status: "pass",
    identity,
    ...selected,
    nativeTimings: report.timings,
  };
}

async function executeGeneration(session) {
  const run = {
    id: session.generation,
    changes: [...session.pending],
    output: join(session.output, `generation-${session.generation}`),
    timings: { jobs: {} },
    startedAt: new Date().toISOString(),
  };
  session.jobTimings = run.timings.jobs;
  session.pending.clear();
  await mkdir(run.output, { recursive: true });
  await writeFile(
    join(run.output, "changes.json"),
    JSON.stringify(run, null, 2),
  );
  await writeStatus(session, {
    status: "running",
    activeGeneration: run.id,
    output: run.output,
  });
  let result;
  const started = performance.now();
  try {
    result = await nativeGeneration(session, run);
  } catch (error) {
    result = { status: "fail", failure: error.message };
  }
  clearTimeout(session.timer);
  if (session.scan) await session.scan;
  clearTimeout(session.timer);
  try {
    await checkChanges(session);
  } catch (error) {
    result = { status: "fail", phase: "watch", failure: error.message };
  }
  if (session.generation !== run.id) {
    result = {
      ...result,
      supersededStatus: result.status,
      status: "superseded",
    };
  }
  if (session.stopping) result.status = "cancelled";
  result.timings = run.timings;
  result.elapsedMs = performance.now() - started;
  await writeFile(
    join(run.output, "result.json"),
    JSON.stringify(result, null, 2),
  );
  session.last = result;
  await writeStatus(session, {
    ...result,
    completedGeneration: run.id,
    output: run.output,
    ready: !session.options.once && !session.stopping,
    rerun:
      "Send SIGUSR1 to the session PID, or edit an input; failed evidence is retained.",
  });
  if (!session.stopping) scheduleScan(session);
}

function installSignals(session) {
  const stop = () => {
    session.stopping = true;
    clearTimeout(session.timer);
    for (const child of session.children) child.kill("SIGTERM");
    session.killTimer = setTimeout(() => {
      for (const child of session.children) child.kill("SIGKILL");
    }, 2000);
    session.wake?.();
  };
  const rerun = () => {
    session.pending.add("manual-rerun");
    session.generation++;
    session.changedAt = 0;
    session.wake?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("SIGUSR1", rerun);
  return () => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.off("SIGUSR1", rerun);
  };
}

async function closeSession(session) {
  session.stopping = true;
  clearTimeout(session.timer);
  clearTimeout(session.killTimer);
  for (const child of session.children) child.kill("SIGKILL");
  await Promise.all([...session.children].map((child) => child.exited));
  if (session.scan) await session.scan;
  await stopOwnedServer(session);
  if (session.browser) await session.browser.close();
}

async function sessionLoop(session) {
  while (!session.stopping) {
    if (session.pending.size && Date.now() - session.changedAt >= COALESCE_MS) {
      await executeGeneration(session);
      if (session.options.once) break;
    } else {
      await new Promise((accept) => {
        session.wake = accept;
      });
      session.wake = null;
    }
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = optionsFor(args);
  if (options.help) {
    console.log(
      "bun client/tools/smoke.js [--once] [--scenarios name,name] [--concurrency 1..4] [--port 3101] [--url http://127.0.0.1:3101/] [--output artifacts/smoke] [--chrome PATH] [--assets DIR] [--server-reference DIR]\nContinuous rerun: SIGUSR1; stop: SIGINT/SIGTERM. Never runs --full or release browser/offline gates.",
    );
    return 0;
  }
  const id = `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`;
  const session = {
    options,
    id,
    output: resolve(options.output, id),
    serial: 0,
    generation: 1,
    pending: new Set(["startup"]),
    children: new Set(),
    changedAt: 0,
    stopping: false,
  };
  await mkdir(session.output, { recursive: true });
  const removeSignals = installSignals(session);
  try {
    session.roots = inputRoots(options, []);
    session.inputs = (await scanInputs(session.roots)).next;
    scheduleScan(session);
    await sessionLoop(session);
    return session.last?.status === "pass" && !session.stopping ? 0 : 1;
  } catch (error) {
    await writeStatus(session, {
      status: "fail",
      phase: "startup",
      failure: error.message,
    });
    return 1;
  } finally {
    removeSignals();
    const timings = {};
    try {
      await measureStage(timings, "teardownMs", () => closeSession(session));
    } finally {
      await writeFile(
        join(session.output, "teardown.json"),
        JSON.stringify({ timings }, null, 2),
      );
    }
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(JSON.stringify({ status: "fail", failure: error.message }));
    process.exitCode = 1;
  }
}
