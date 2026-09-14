import { parseArgs } from "node:util";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runOnlineCabDialogue } from "../../client/tools/scenarios/online-cab-dialogue.js";

/** Detached beginners beside Henesys Regular Cab, with explicit fare/insufficient-fare fixtures. */
async function seed(database, content) {
  const manifest = await content.map(100000000);
  const npc = manifest.life.placements.find(
    (entry) => entry.template === "npc:1012000",
  );
  const passwordHash = await Bun.password.hash("password");
  for (const [name, meso] of [
    ["cabrider", 2000],
    ["cabpoor", 0],
  ]) {
    const account = await database.createAccount({
      name,
      passwordHash,
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
    profile.name = name === "cabrider" ? "CabRider" : "CabPoor";
    profile.meso = meso;
    await database.createCharacter(account.id, profile);
  }
}

function options(args) {
  if (args.length > 4) throw new Error("Too many cab-check arguments");
  const { values, tokens } = parseArgs({
    args,
    options: {
      output: { type: "string", default: "/tmp/openms-cab-dialogue" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
    tokens: true,
  });
  const seen = new Set();
  for (const token of tokens) {
    if (seen.has(token.name)) throw new Error(`Repeated flag: --${token.name}`);
    seen.add(token.name);
  }
  if (!values.output.trim()) throw new Error("--output must name a directory");
  return values;
}

async function main() {
  const values = options(process.argv.slice(2));
  if (values.help) {
    console.log(
      "Usage: bun server/tools/check-cab-dialogue.js [--output DIR]\nDefault output: /tmp/openms-cab-dialogue\nRuns native cab/cancellation checks with disposable service fixtures.",
    );
    return;
  }
  const report = await isolatedOnlineCheck({
    seed,
    run: runOnlineCabDialogue,
    output: values.output,
  });
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks,
      failure: report.failure,
    }),
  );
  process.exit(report.status === "pass" ? 0 : 1);
}

if (import.meta.main) await main();
