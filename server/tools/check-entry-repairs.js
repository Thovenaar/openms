import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runOnlineEntryRepairs } from "../../client/tools/scenarios/online-entry-repairs.js";

/** Two detached fixtures beside empty/blocked NPCs; BGM muted to isolate Jump PCM. */
async function seed(database, content) {
  const manifest = await content.map(100000000);
  const passwordHash = await Bun.password.hash("password");
  for (const [name, x, count] of [
    ["entry", 1540, 3],
    ["unavailable", 3160, 1],
  ]) {
    const account = await database.createAccount({
      name,
      passwordHash,
      role: "player",
    });
    for (let slot = 0; slot < count; slot++) {
      const profile = createProfile({
        mapId: manifest.id,
        ...nearestSavedArrival(manifest, { x, y: 334, facing: 1 }),
      });
      profile.name = `${name === "entry" ? "Entry" : "Service"}${slot}`;
      profile.settings.BGM.mute = true;
      await database.createCharacter(account.id, profile);
    }
  }
}

if (import.meta.main) {
  const report = await isolatedOnlineCheck({
    seed,
    run: runOnlineEntryRepairs,
    output: process.argv[2] ?? "/tmp/openms-entry-repairs",
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
