import { createProfile } from "../../client/src/profile/profile-validation.js";
import { recalculateVitals } from "../../client/src/character/character-stats.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { keyIndexForCode } from "../../client/src/input/keymap.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runOnlinePartySkills } from "../../client/tools/scenarios/online-party-skills.js";

/** Earned progression is not under test: grant Haste and a two-member party explicitly. */
async function seed(database, content) {
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const manifest = await content.map(100000000);
  const arrival = nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 });
  const passwordHash = await Bun.password.hash("password");
  for (const [index, name] of ["admin", "player"].entries()) {
    const role = index === 0 ? "developer" : "player";
    const account = await database.createAccount({ name, role, passwordHash });
    const profile = createProfile({ mapId: manifest.id, ...arrival });
    Object.assign(profile, {
      name: index === 0 ? "Developer" : "Player",
      job: index === 0 ? 412 : 0,
      level: 120,
      baseMaxMP: 1000,
      baseMaxHP: 1000,
    });
    profile.social.party = { id: ids[0], leaderId: ids[0], members: ids };
    if (index === 0) {
      profile.skills[4101004] = { level: 20, masterLevel: 20, expiresAt: null };
      profile.keyBindings.keys[keyIndexForCode("KeyH")] = {
        type: 1,
        id: 4101004,
      };
    }
    recalculateVitals(profile, content.items);
    profile.hp = profile.maxHP;
    profile.mp = profile.maxMP;
    database.validate(profile);
    await database.transaction((tx) =>
      database.insertCharacter(tx, account.id, profile, ids[index]),
    );
  }
}

if (import.meta.main) {
  const report = await isolatedOnlineCheck({
    seed,
    run: runOnlinePartySkills,
    output: process.argv[2] ?? "/tmp/openms-party-skills",
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
