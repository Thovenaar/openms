import { parseArgs } from "node:util";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runOnlineLoginPages } from "../../client/tools/scenarios/online-login-pages.js";

/** Four detached roster characters exercise both directions of the native page signs. */
async function seed(database, content, count = 4) {
  const map = await content.map(100000000);
  const account = await database.createAccount({
    name: "loginpages",
    passwordHash: await Bun.password.hash("password"),
    role: "player",
  });
  for (let slot = 0; slot < count; slot++) {
    const profile = createProfile({
      mapId: map.id,
      ...nearestSavedArrival(map, { x: 1540, y: 334, facing: 1 }),
    });
    profile.name = ["Ill", "Wanderer", "MaplePlayerX", "PageFour"][slot];
    await database.createCharacter(account.id, profile);
  }
}

function options(args) {
  if (args.length > 6) throw new Error("Too many login-page check arguments");
  const { values, tokens } = parseArgs({
    args,
    options: {
      output: { type: "string", default: "/tmp/openms-login-pages" },
      scope: { type: "string", default: "pages" },
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
  if (!["pages", "controls"].includes(values.scope)) {
    throw new Error("--scope must be pages or controls");
  }
  return values;
}

async function main() {
  const values = options(process.argv.slice(2));
  if (values.help) {
    console.log(
      "Usage: bun server/tools/check-login-pages.js [--output DIR] [--scope pages|controls]\nDefaults: output=/tmp/openms-login-pages, scope=pages\nPages checks transitions/arrows; controls checks recovery buttons and character names. Uses a disposable account/database without entering gameplay.",
    );
    return;
  }
  const report = await isolatedOnlineCheck({
    seed: (database, content) =>
      seed(database, content, values.scope === "controls" ? 3 : 4),
    run: (options) => runOnlineLoginPages({ ...options, scope: values.scope }),
    output: values.output,
  });
  console.log(
    JSON.stringify({ status: report.status, failure: report.failure }),
  );
  process.exitCode = report.status === "pass" ? 0 : 1;
}

if (import.meta.main) await main();
