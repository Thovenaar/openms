import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { catalog as validateCatalog } from "../src/rendering/stream-validation.js";
import {
  boundedResponse,
  validateDescriptor,
  verifyBytes,
  sha256,
  HASH,
  resourceByteLimit,
} from "../public/offline-manifest.js";
import { sourceIdentity } from "./browser-build.js";
import {
  boundedJSON,
  prepareFixture,
  seedFixture,
  readRerun,
} from "./native-fixtures.js";
import {
  assertion,
  failureDetails,
  createEvidence,
  compactState,
  stateDelta,
  measureStage,
} from "./native-evidence.js";

export const SCENARIO_NAMES = Object.freeze([
  "world-tour-return",
  "claw-close-skill",
  "window-map-travel",
  "inspection-errors",
  "same-map-teleport",
  "npc-talk-menu",
  "social-invitations",
  "diagnostic-replay",
  "reload-spawn",
  "npc-default-dialogue",
  "npc-shop-name",
  "skill-book-equipped-scroll",
  "tutorial-drops",
  "quest-ready-notification",
  "offline-thief-advancement",
  "development-loadout-spawn",
]);
const READY_TIMEOUT_MS = 120000;
const SCENARIO_TIMEOUT_MS = 300000;
const MAX_CONCURRENCY = 4;

/** Browser policy: serial by default; each worker owns an independent context. */
export function scenarioConcurrency(value = 1) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CONCURRENCY) {
    throw new RangeError(
      `Scenario concurrency must be an integer from 1 to ${MAX_CONCURRENCY}`,
    );
  }
  return count;
}
const DEFAULT_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function requireCurrentCatalog(digest) {
  const file = Bun.file(
    new URL("../public/generated/catalog.json", import.meta.url),
  );
  const bytes = await boundedResponse(
    new Response(file),
    resourceByteLimit("/generated/catalog.json"),
  );
  if ((await sha256(bytes)) !== digest) {
    throw new Error(
      "Served asset catalog differs from the current workspace publication; rebuild the dev server",
    );
  }
}
async function loadAssets(url) {
  const response = await fetch(new URL("/generated/catalog.json", url), {
    redirect: "error",
    signal: AbortSignal.timeout(READY_TIMEOUT_MS),
  });
  const bytes = await boundedResponse(
    response,
    resourceByteLimit("/generated/catalog.json"),
  );
  const catalogSha256 = await sha256(bytes);
  await requireCurrentCatalog(catalogSha256);
  const catalog = validateCatalog(JSON.parse(new TextDecoder().decode(bytes)));
  if (!HASH.test(catalog.buildId)) {
    throw new Error("Catalog lacks a valid asset build identity");
  }
  const loadJSON = async (descriptor) => {
    validateDescriptor(descriptor);
    const response = await fetch(new URL(descriptor.url, url), {
      redirect: "error",
      signal: AbortSignal.timeout(READY_TIMEOUT_MS),
    });
    const bytes = await boundedResponse(response, descriptor.bytes);
    await verifyBytes(bytes, descriptor);
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  return { catalog, loadJSON, catalogSha256 };
}

/** Observe gameplay across the service worker's first-control navigation. */
export async function waitForNativeReady(page, timeout = READY_TIMEOUT_MS) {
  const result = await page.waitForFunction(
    () => {
      if (!window.maple) return false;
      const state = window.maple.snapshot();
      const offline = state.offline;
      if (!offline) return false;
      // A transport warning precedes verified offline fallback. Only the visible
      // retry control means startup has actually stopped rather than progressing.
      const retry = document.querySelector(
        "#delivery-startup button:not([hidden])",
      );
      if (offline.error && retry) {
        return { startupError: offline.error };
      }
      if (!state.currentMap) return false;
      return (
        offline.launchReady &&
        state.field.gameplay?.prepared &&
        !state.loading &&
        state.fieldTransition.phase === "idle" &&
        state.inGame.ui.pending.length === 0 &&
        !state.save.profileTransactionPending
      );
    },
    { timeout },
  );
  try {
    const state = await result.jsonValue();
    if (state.startupError) {
      throw new Error(`Native startup failed: ${state.startupError}`);
    }
  } finally {
    await result.dispose();
  }
}

function checkIdentities(state, identities) {
  assertion(
    HASH.test(state.sourceBuildId ?? ""),
    "Runtime source identity is absent",
    { actual: state.sourceBuildId },
  );
  assertion(
    state.sourceBuildId === identities.sourceBuildId,
    "Served browser source is stale",
    {
      actual: state.sourceBuildId,
      expected: identities.sourceBuildId,
    },
  );
  assertion(
    state.buildId === identities.assetBuildId,
    "Runtime asset build differs from fetched catalog",
    {
      actual: state.buildId,
      expected: identities.assetBuildId,
    },
  );
}

async function descriptors(names) {
  const selected = names?.length ? names : SCENARIO_NAMES;
  if (
    selected.length > SCENARIO_NAMES.length ||
    new Set(selected).size !== selected.length
  ) {
    throw new Error("Duplicate or excessive scenario selection");
  }
  const result = [];
  for (const name of selected) {
    if (!SCENARIO_NAMES.includes(name)) {
      throw new Error(`Unknown native scenario: ${name}`);
    }
    const { default: descriptor } = await import(`./scenarios/${name}.js`);
    validateScenarioDescriptor(descriptor, name);
    result.push(descriptor);
  }
  return result;
}

function validateScenarioDescriptor(descriptor, name) {
  if (
    descriptor.name !== name ||
    descriptor.recipe !== 1 ||
    typeof descriptor.fixture !== "function" ||
    typeof descriptor.run !== "function" ||
    !Array.isArray(descriptor.mapIds) ||
    !Array.isArray(descriptor.dependencies)
  ) {
    throw new Error(`Invalid native scenario descriptor: ${name}`);
  }
}

export async function listNativeScenarios() {
  const selected = await descriptors();
  return selected.map(({ name, recipe, mapIds, dependencies }) => ({
    name,
    recipe,
    mapIds,
    dependencies,
  }));
}

export async function acquireBrowser(options) {
  if (options.browser) {
    return { browser: options.browser, ownership: "borrowed-object" };
  }
  const browserWSEndpoint = options.browserWSEndpoint;
  if (browserWSEndpoint) {
    return {
      browser: await puppeteer.connect({ browserWSEndpoint }),
      ownership: "borrowed-connection",
    };
  }
  return {
    browser: await puppeteer.launch({
      executablePath: options.chrome ?? DEFAULT_CHROME,
      headless: !options.headed,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
      ],
    }),
    ownership: "owned",
  };
}

async function scenarioInputs(descriptor, environment) {
  const saved = environment.rerun;
  const fixture =
    saved?.inputs.fixture ?? (await descriptor.fixture(environment));
  const inputs = {
    fixture: prepareFixture(fixture, environment.catalog),
    parameters: saved?.inputs.parameters ?? environment.parameters ?? {},
  };
  const artifact = {
    schemaVersion: 1,
    scenario: descriptor.name,
    recipe: descriptor.recipe,
    originalIdentities: saved?.originalIdentities ?? environment.identities,
    capturedIdentities: environment.identities,
    inputs,
  };
  await writeFile(
    join(environment.output, "inputs.json"),
    boundedJSON(artifact),
  );
  return { inputs, originalIdentities: artifact.originalIdentities };
}

async function executeScenario(descriptor, environment, browser) {
  const started = performance.now();
  const output = join(environment.output, descriptor.name);
  await mkdir(output, { recursive: true });
  const result = {
    name: descriptor.name,
    recipe: descriptor.recipe,
    status: "running",
    output,
    dependencies: descriptor.dependencies,
    identities: environment.identities,
    seededInputs: null,
    timings: {},
    startedAt: new Date().toISOString(),
  };
  const session = { context: null, page: null, evidence: null };
  try {
    const prepared = await measureStage(
      result.timings,
      "fixturePrepareMs",
      () => scenarioInputs(descriptor, { ...environment, output }),
    );
    result.seededInputs = "inputs.json";
    result.originalIdentities = prepared.originalIdentities;
    result.fixtureSeeding = { status: "validated", earnedProgress: false };
    await prepareScenarioPage(session, result, {
      browser,
      environment,
      prepared,
      output,
    });
    await nativeActions(
      descriptor,
      { ...environment, page: session.page, output, inputs: prepared.inputs },
      session.evidence,
      result,
    );
  } catch (error) {
    await measureStage(result.timings, "failureCaptureMs", () =>
      captureScenarioFailure(session, result, error),
    );
  } finally {
    await measureStage(result.timings, "teardownMs", () =>
      retireScenario(session, result),
    );
    result.elapsedMs = performance.now() - started;
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ schemaVersion: 1, ...result }, null, 2),
  );
  return result;
}

async function prepareScenarioPage(session, result, setup) {
  const { browser, environment, prepared, output } = setup;
  const timings = result.timings;
  await measureStage(timings, "contextAcquireMs", async () => {
    session.context = await browser.createBrowserContext();
    session.page = await session.context.newPage();
    await session.page.setViewport({
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
    });
  });
  const page = session.page;
  await measureStage(timings, "fixtureSeedMs", () =>
    withDeadline(
      seedFixture(page, environment.url, prepared.inputs.fixture),
      READY_TIMEOUT_MS,
      "Fixture seeding",
    ),
  );
  result.fixtureSeeding.status = "seeded-stopped-page";
  session.evidence = await measureStage(timings, "evidenceSetupMs", () =>
    createEvidence(page, output),
  );
  await measureStage(timings, "navigationMs", () =>
    page.goto(environment.url, {
      waitUntil: "domcontentloaded",
      timeout: READY_TIMEOUT_MS,
    }),
  );
}

async function captureScenarioFailure(session, result, error) {
  result.status = "fail";
  result.failure = failureDetails(error);
  if (session.page && !session.page.isClosed()) {
    try {
      result.after = await session.page.evaluate(compactState);
      result.errorLog = await session.page.evaluate(() => {
        const text = document.querySelector("#error")?.value ?? "";
        return { text: text.slice(0, 32768), truncated: text.length > 32768 };
      });
    } catch (snapshotError) {
      result.snapshotError = failureDetails(snapshotError);
    }
  }
  result.nativeActionDelta = stateDelta(result.before, result.after);
  if (session.evidence) {
    try {
      result.captures = await session.evidence.failure();
    } catch (captureError) {
      result.captureError = failureDetails(captureError);
    }
  }
}

async function retireScenario(session, result) {
  if (session.evidence) {
    result.checkpoints = session.evidence.checkpoints;
    result.events = session.evidence.events;
    try {
      await session.evidence.close();
    } catch (error) {
      result.teardownError = failureDetails(error);
      result.status = "fail";
    }
  }
  if (session.context) {
    try {
      await session.context.close();
    } catch (error) {
      result.contextError = failureDetails(error);
      result.status = "fail";
    }
  }
}

async function nativeActions(descriptor, context, evidence, result) {
  const { page, identities } = context;
  await measureStage(result.timings, "readinessMs", () =>
    waitForNativeReady(page),
  );
  checkIdentities(await page.evaluate(compactState), identities);
  result.before = await evidence.checkpoint("native-actions-start");
  result.observations = await measureStage(result.timings, "actionsMs", () =>
    runDescriptor(descriptor, {
      ...context,
      assert: assertion,
      snapshot: () => page.evaluate(compactState),
      checkpoint: evidence.checkpoint,
    }),
  );
  await measureStage(result.timings, "finalReadinessMs", () =>
    waitForNativeReady(page),
  );
  checkIdentities(await page.evaluate(compactState), identities);
  const currentSourceBuildId = await measureStage(
    result.timings,
    "finalIdentityMs",
    sourceIdentity,
  );
  await measureStage(result.timings, "finalCatalogMs", () =>
    requireCurrentCatalog(identities.catalogSha256),
  );
  assertion(
    currentSourceBuildId === identities.sourceBuildId,
    "Workspace browser sources changed during scenario execution",
    { actual: currentSourceBuildId, expected: identities.sourceBuildId },
  );
  result.after = await evidence.checkpoint("native-actions-complete");
  result.nativeActionDelta = stateDelta(result.before, result.after);
  result.status = "pass";
}

function runDescriptor(descriptor, context) {
  return withDeadline(
    descriptor.run(context),
    SCENARIO_TIMEOUT_MS,
    "Native scenario",
  );
}

async function withDeadline(operation, timeoutMs, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} exceeded ${timeoutMs}ms deadline`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Fixed-size worker pool; retain selection order and drain all workers before browser teardown. */
async function executeSelected(prepared, connection, report) {
  let next = 0;
  const selected = prepared.selected;
  const worker = async () => {
    for (let work = 0; work < selected.length; work++) {
      const index = next++;
      if (index >= selected.length) return;
      try {
        report.scenarios[index] = await executeScenario(
          selected[index],
          prepared.environment,
          connection.browser,
        );
      } catch (error) {
        report.scenarios[index] = {
          name: selected[index].name,
          status: "fail",
          output: join(prepared.environment.output, selected[index].name),
          failure: failureDetails(error),
        };
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(report.concurrency, selected.length) },
      worker,
    ),
  );
}

/** One isolated context per scenario; never owns a caller's browser or existing pages. */
export async function runNativeScenarios(options = {}) {
  const output = resolve(options.output ?? "artifacts/native-scenarios");
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    status: "running",
    scenarios: [],
    concurrency: scenarioConcurrency(options.concurrency),
    timings: {},
  };
  const started = performance.now();
  let connection;
  try {
    const prepared = await measureStage(
      report.timings,
      "catalogIdentityMs",
      () => prepareRun(options, output, report),
    );
    connection = await measureStage(report.timings, "browserAcquireMs", () =>
      acquireBrowser(options),
    );
    report.browserOwnership = connection.ownership;
    await measureStage(report.timings, "scenariosMs", () =>
      executeSelected(prepared, connection, report),
    );
    report.status = report.scenarios.every((result) => result.status === "pass")
      ? "pass"
      : "fail";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
  } finally {
    const teardownStarted = performance.now();
    try {
      if (connection?.ownership === "owned") await connection.browser.close();
      else if (connection?.ownership === "borrowed-connection") {
        await connection.browser.disconnect();
      }
    } catch (error) {
      report.status = "fail";
      report.teardownError = failureDetails(error);
    }
    report.timings.teardownMs = performance.now() - teardownStarted;
    report.elapsedMs = performance.now() - started;
    await writeFile(
      join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
  return report;
}

async function prepareRun(options, output, report) {
  const rerun = options.rerun
    ? await readRerun(options.rerun, SCENARIO_NAMES)
    : null;
  if (
    rerun &&
    options.names?.length &&
    (options.names.length !== 1 || options.names[0] !== rerun.scenario)
  ) {
    throw new Error("Rerun selection conflicts with saved scenario");
  }
  const selected = await descriptors(rerun ? [rerun.scenario] : options.names);
  const url = new URL(options.url ?? "http://127.0.0.1:3100").href;
  const assets = await loadAssets(url);
  const sourceBuildId = await sourceIdentity();
  if (!HASH.test(sourceBuildId)) {
    throw new Error("Workspace source identity is absent or invalid");
  }
  report.identities = {
    sourceBuildId,
    assetBuildId: assets.catalog.buildId,
    catalogSha256: assets.catalogSha256,
  };
  return {
    selected,
    environment: {
      ...assets,
      url,
      output,
      rerun,
      parameters: options.parameters,
      identities: report.identities,
    },
  };
}
