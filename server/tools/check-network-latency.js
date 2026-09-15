import { parseArgs } from "node:util";
import { join } from "node:path";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { DelayedTraffic } from "../../client/tools/scenarios/delayed-traffic.js";
import { runOnlineLatency } from "../../client/tools/scenarios/online-latency.js";
import { runOnlineStartup } from "../../client/tools/scenarios/online-startup.js";
import { runBrowserCache } from "../../client/tools/scenarios/browser-cache.js";

async function seed(database, content) {
  const manifest = await content.map(100000000);
  const npc = manifest.life.placements.find(
    (entry) => entry.template === "npc:1012000",
  );
  const account = await database.createAccount({
    name: "latency",
    passwordHash: await Bun.password.hash("password"),
    role: "player",
  });
  const profile = createProfile({
    mapId: manifest.id,
    ...nearestSavedArrival(manifest, {
      x: npc.authored.x + 30,
      y: npc.authored.cy,
      facing: -1,
    }),
  });
  profile.name = "Latency";
  profile.meso = 2000;
  await database.createCharacter(account.id, profile);
}
function options(args) {
  const { values, tokens } = parseArgs({
    args,
    allowPositionals: false,
    tokens: true,
    options: {
      output: { type: "string", default: "/tmp/openms-network-latency" },
      scope: { type: "string", default: "latency" },
      help: { type: "boolean" },
    },
  });
  const seen = new Set();
  for (const token of tokens) {
    if (seen.has(token.name)) throw new Error(`Repeated flag: --${token.name}`);
    seen.add(token.name);
  }
  if (!values.output.trim()) throw new Error("--output must name a directory");
  if (!["latency", "startup", "cache"].includes(values.scope)) {
    throw new Error("--scope must be latency, startup or cache");
  }
  return values;
}
if (import.meta.main) {
  const args = options(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: bun server/tools/check-network-latency.js [--output DIR] [--scope latency|startup|cache]\nDefaults: /tmp/openms-network-latency, latency\nStartup and latency use 500ms HTTP/WebSocket RTT with disposable accounts. Cache measures real browser storage without gameplay, database or network latency.",
    );
  } else {
    const fixtureTimings = {};
    const report =
      args.scope === "cache"
        ? await runBrowserCache()
        : await isolatedOnlineCheck({
            seed,
            run: args.scope === "startup" ? runOnlineStartup : runOnlineLatency,
            output: args.output,
            network: new DelayedTraffic(500),
            timings: fixtureTimings,
          });
    report.fixtureTimings = fixtureTimings;
    await Bun.write(
      join(args.output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        status: report.status,
        timings: report.timings,
        checks: report.checks,
        failure: report.failure,
      }),
    );
    process.exitCode = report.status === "pass" ? 0 : 1;
  }
}
