import { parseArgs } from "node:util";
import { join } from "node:path";
import {
  runNativeScenarios,
  SCENARIO_NAMES,
  listNativeScenarios,
} from "./native-scenario-runner.js";

export { runNativeScenarios, SCENARIO_NAMES, listNativeScenarios };

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      output: { type: "string" },
      chrome: { type: "string" },
      browserWSEndpoint: { type: "string" },
      rerun: { type: "string" },
      concurrency: { type: "string", default: "1" },
      headed: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
    },
  });
  if (values.list || (positionals.length === 1 && positionals[0] === "list")) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        scenarios: await listNativeScenarios(),
      }),
    );
    return 0;
  }
  const names =
    positionals.length === 1 && positionals[0] === "all" ? [] : positionals;
  const report = await runNativeScenarios({ ...values, names });
  console.log(
    JSON.stringify({
      schemaVersion: report.schemaVersion,
      status: report.status,
      elapsedMs: report.elapsedMs,
      concurrency: report.concurrency,
      browserOwnership: report.browserOwnership,
      timings: report.timings,
      identities: report.identities,
      failure: report.failure && {
        name: report.failure.name,
        message: report.failure.message,
      },
      scenarios: report.scenarios.map(
        ({ name, status, output, failure, elapsedMs, timings }) => ({
          name,
          status,
          elapsedMs,
          timings,
          report: join(output, "report.json"),
          ...(failure && {
            failure: { name: failure.name, message: failure.message },
          }),
        }),
      ),
    }),
  );
  return report.status === "pass" ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        status: "fail",
        failure: { name: error.name, message: error.message },
      }),
    );
    process.exitCode = 1;
  }
}
