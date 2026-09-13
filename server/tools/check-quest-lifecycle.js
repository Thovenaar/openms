import { createProfile } from "../../client/src/profile/profile-validation.js";
import { recalculateVitals } from "../../client/src/character/character-stats.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { grantItem } from "../../client/src/items/inventory-model.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runOnlineQuestLifecycle } from "../../client/tools/scenarios/online-quest-lifecycle.js";

/** Explicit fixture: one warrior beside original Arwen, with one glass shoe for the claim. */
async function seed(database, content) {
  const account = await database.createAccount({
    name: "player",
    role: "player",
    passwordHash: await Bun.password.hash("password"),
  });
  const manifest = await content.map(101000000);
  const npc = manifest.life.placements.find(
    (entry) => entry.template === "npc:1032100",
  );
  const arrival = nearestSavedArrival(manifest, {
    x: npc.authored.x + 20,
    y: npc.authored.cy,
    facing: -1,
  });
  const profile = createProfile({ mapId: manifest.id, ...arrival });
  Object.assign(profile, {
    name: "Player",
    job: 100,
    level: 120,
    baseMaxHP: 1000,
    baseMaxMP: 1000,
  });
  recalculateVitals(profile, content.items);
  profile.hp = profile.maxHP;
  profile.mp = profile.maxMP;
  grantItem(profile, content.items[4001000], 1);
  await database.createCharacter(account.id, profile);
}

if (import.meta.main) {
  const report = await isolatedOnlineCheck({
    seed,
    run: runOnlineQuestLifecycle,
    output: process.argv[2] ?? "/tmp/openms-quest-lifecycle",
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
