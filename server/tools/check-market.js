import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { recalculateVitals } from "../../client/src/character/character-stats.js";
import { grantItem } from "../../client/src/items/inventory-model.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runOnlineMarket } from "../../client/tools/scenarios/online-market.js";

/** Disposable accounts explicitly receive prepaid test NX; this is not a payment or production grant. */
async function seed(database, content) {
  const manifest = await content.map(100000000);
  const arrival = nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 });
  const passwordHash = await Bun.password.hash("password");
  for (const [index, name] of ["admin", "player"].entries()) {
    const account = await database.createAccount({
      name,
      passwordHash,
      role: index ? "player" : "developer",
    });
    const profile = createProfile({ mapId: manifest.id, ...arrival });
    Object.assign(profile, {
      name: index ? "Player" : "Developer",
      level: 30,
      baseMaxHP: 1000,
      baseMaxMP: 1000,
    });
    recalculateVitals(profile, content.items);
    profile.hp = profile.maxHP;
    profile.mp = profile.maxMP;
    profile.cash.balances.prepaid = 10000;
    if (!index) grantItem(profile, content.items[2000000], 10);
    await database.createCharacter(account.id, profile);
  }
}

if (import.meta.main) {
  const report = await isolatedOnlineCheck({
    seed,
    run: runOnlineMarket,
    output: process.argv[2] ?? "/tmp/openms-market",
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
