import { createProfile } from "../../client/src/profile/profile-validation.js";
import { recalculateVitals } from "../../client/src/character/character-stats.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runStudioContent } from "../../client/tools/scenarios/studio-content.js";

/** Only accounts and starting characters are fixtures. All authored content comes from native Studio input. */
async function seed(database, content) {
  const manifest = await content.map(100000000);
  const npc = manifest.life.placements.find(
    (row) => row.template === "npc:1012108",
  );
  const arrival = nearestSavedArrival(manifest, {
    x: npc.authored.x + 20,
    y: npc.authored.cy,
    facing: -1,
  });
  const passwordHash = await Bun.password.hash("password");
  for (const name of ["admin", "player"]) {
    const role = name === "admin" ? "developer" : "player";
    const account = await database.createAccount({ name, role, passwordHash });
    const profile = createProfile({ mapId: manifest.id, ...arrival });
    Object.assign(profile, {
      name: name === "admin" ? "Developer" : "Player",
      baseMaxHP: 1000,
      baseMaxMP: 1000,
    });
    recalculateVitals(profile, content.items);
    profile.hp = profile.maxHP;
    profile.mp = profile.maxMP;
    await database.createCharacter(account.id, profile);
  }
}

if (import.meta.main) {
  const report = await isolatedOnlineCheck({
    seed,
    run: runStudioContent,
    studio: true,
    output: process.argv[2] ?? "/tmp/openms-studio",
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
