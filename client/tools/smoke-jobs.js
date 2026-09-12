import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;

export async function readJSON(path) {
  const file = Bun.file(path);
  if (file.size > MAX_REPORT_BYTES) {
    throw new Error(`Report exceeds ${MAX_REPORT_BYTES} bytes: ${path}`);
  }
  return JSON.parse(await readFile(path, "utf8"));
}

/** Each invocation reloads the CLI and every transitive scenario/recipe import. */
export async function runJob(session, options) {
  if (session.stopping) throw new Error("Smoke session cancelled");
  const started = performance.now();
  await mkdir(options.output, { recursive: true });
  const stdout = join(options.output, `${options.label}.stdout.json`);
  const stderr = join(options.output, `${options.label}.stderr.log`);
  const child = Bun.spawn([process.execPath, ...options.args], {
    cwd: session.options.repository,
    stdout: Bun.file(stdout),
    stderr: Bun.file(stderr),
    env: {
      ...process.env,
      MAPLE_ASSETS: session.options.assets,
      MAPLE_SERVER_REFERENCE: session.options.serverReference,
    },
  });
  session.children.add(child);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, JOB_TIMEOUT_MS);
  try {
    const code = await child.exited;
    if (timedOut || code !== 0) {
      throw new Error(
        `${options.label} ${timedOut ? "timed out" : `exited ${code}`}; inspect ${stderr} and ${stdout}`,
      );
    }
    return stdout;
  } finally {
    clearTimeout(timer);
    session.children.delete(child);
    const elapsedMs = performance.now() - started;
    if (session.jobTimings) {
      session.jobTimings[`${options.label}Ms`] = elapsedMs;
    }
    await writeFile(
      join(options.output, `${options.label}.timing.json`),
      JSON.stringify({ elapsedMs, timedOut }, null, 2),
    );
  }
}

export async function writeStatus(session, state) {
  const record = {
    schemaVersion: 1,
    session: session.id,
    pid: process.pid,
    generation: session.generation,
    updatedAt: new Date().toISOString(),
    ...state,
  };
  const temporary = join(session.output, `status-${session.serial++}.tmp`);
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, join(session.output, "status.json"));
  console.log(JSON.stringify(record));
}

export async function loadScenarios(session, output) {
  const stdout = await runJob(session, {
    label: "list",
    output,
    args: ["client/tools/native-scenarios.js", "--list"],
  });
  const report = await readJSON(stdout);
  validateScenarioMetadata(report);
  const names = session.options.scenarios;
  for (const name of names) {
    if (!report.scenarios.some((entry) => entry.name === name)) {
      throw new Error(`Unknown scenario: ${name}`);
    }
  }
  const selected = report.scenarios.filter(
    (entry) => !names.length || names.includes(entry.name),
  );
  if (!selected.length) throw new Error("No native scenarios selected");
  return selected;
}

function validateScenarioMetadata(report) {
  if (
    report.schemaVersion !== 1 ||
    !Array.isArray(report.scenarios) ||
    report.scenarios.length > 64
  ) {
    throw new Error("Invalid native scenario metadata");
  }
  for (const entry of report.scenarios) {
    if (
      typeof entry.name !== "string" ||
      !Array.isArray(entry.dependencies) ||
      entry.dependencies.length > 256 ||
      entry.dependencies.some((path) => typeof path !== "string") ||
      !Array.isArray(entry.mapIds)
    ) {
      throw new Error("Invalid native scenario dependencies");
    }
  }
}
