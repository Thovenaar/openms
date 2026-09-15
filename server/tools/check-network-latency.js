import { parseArgs } from "node:util";
import { join } from "node:path";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { DelayedTraffic } from "../../client/tools/scenarios/delayed-traffic.js";
import { runOnlineLatency } from "../../client/tools/scenarios/online-latency.js";

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
      help: { type: "boolean" },
    },
  });
  const seen = new Set();
  for (const token of tokens) {
    if (seen.has(token.name)) throw new Error(`Repeated flag: --${token.name}`);
    seen.add(token.name);
  }
  if (!values.output.trim()) throw new Error("--output must name a directory");
  return values;
}
if (import.meta.main) {
  const args = options(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: bun server/tools/check-network-latency.js [--output DIR]\nDefault output: /tmp/openms-network-latency\nDisposable native check: 500ms HTTP/WebSocket RTT, stalled assets, movement, dialogue, travel and reconnect.",
    );
  } else {
    const fixtureTimings = {};
    const report = await isolatedOnlineCheck({
      seed,
      run: runOnlineLatency,
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
