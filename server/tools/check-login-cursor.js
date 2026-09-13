import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runOnlineLoginCursor } from "../../client/tools/scenarios/online-login-cursor.js";

async function seed(database, content) {
  const manifest = await content.map(100000000);
  const account = await database.createAccount({
    name: "admin",
    passwordHash: await Bun.password.hash("password"),
    role: "developer",
  });
  const profile = createProfile({
    mapId: manifest.id,
    ...nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 }),
  });
  profile.name = "Developer";
  await database.createCharacter(account.id, profile);
}

if (import.meta.main) {
  const report = await isolatedOnlineCheck({
    seed,
    run: runOnlineLoginCursor,
    output: process.argv[2] ?? "/tmp/openms-login-cursor",
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
