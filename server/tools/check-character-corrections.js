import { parseFlags } from "../../client/tools/source-options.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { experienceRequired } from "../../client/src/character/offline-progression.js";
import { grantItem } from "../../client/src/items/inventory-model.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runCharacterCorrections } from "../../client/tools/scenarios/online-character-corrections.js";

/** Explicit fixture only: authored items, quest prerequisites and learned Spirit; real server RNG. */
async function seed(database, content) {
  const passwordHash = await Bun.password.hash("password");
  for (const name of ["corrections", "witness"]) {
    const account = await database.createAccount({
      name,
      passwordHash,
      role: "player",
    });
    const profile = createProfile({
      mapId: "001000000",
      x: 520,
      y: 274,
      facing: 1,
    });
    profile.name = name === "corrections" ? "Corrections" : "Witness";
    profile.settings.BGM.mute = true;
    if (name === "corrections") {
      profile.job = 110;
      profile.level = 30;
      profile.exp = experienceRequired(30) - 1;
      profile.remainingSp[0] = 12;
      profile.skills[1003] = { level: 1, masterLevel: 0, expiresAt: null };
      profile.keyBindings.keys[32] = { type: 1, id: 1003 };
      profile.quests[1008] = { state: 1, kills: {} };
      for (const id of [4031161, 4031162, 1302023]) {
        grantItem(profile, content.items[id], 1);
      }
      grantItem(profile, content.items[1302000], 4);
      grantItem(profile, content.items[2043005], 64);
      grantItem(profile, content.items[2340000], 64);
    }
    await database.createCharacter(account.id, profile);
  }
}

if (import.meta.main) {
  const flags = parseFlags(process.argv.slice(2), {
    output: { type: "string" },
    help: { type: "boolean" },
  });
  if (flags.help) {
    console.log(
      "bun server/tools/check-character-corrections.js [--output DIR]\nDefault: /tmp/openms-character-corrections. Disposable accounts/database; native equipment, scrolling, quest level-up and skill allocation. Retains real RNG outcomes; at most 64 scroll attempts per target.",
    );
  } else {
    const report = await isolatedOnlineCheck({
      seed,
      run: runCharacterCorrections,
      output: flags.output ?? "/tmp/openms-character-corrections",
    });
    console.log(
      JSON.stringify({ status: report.status, failure: report.failure }),
    );
    process.exitCode = report.status === "pass" ? 0 : 1;
  }
}
