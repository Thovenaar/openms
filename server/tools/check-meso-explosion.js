import { parseFlags } from "../../client/tools/source-options.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runMesoExplosion } from "../../client/tools/scenarios/online-meso-explosion.js";

/** Disposable Chief Bandit; gameplay drops and casts use native controls. */
async function seed(database) {
  const account = await database.createAccount({
    name: "meso",
    passwordHash: await Bun.password.hash("password"),
    role: "player",
  });
  const profile = createProfile({ mapId: "100000000", x: 0, y: 0, facing: 1 });
  profile.name = "Meso";
  profile.job = 421;
  profile.level = 100;
  profile.meso = 10000;
  profile.maxMP = profile.baseMaxMP = profile.mp = 1000;
  profile.equipment.find((item) => item.slot === -11).id = 1332000;
  profile.skills[4211006] = { level: 30, masterLevel: 0, expiresAt: null };
  profile.keyBindings.keys[32] = { type: 1, id: 4211006 };
  await database.createCharacter(account.id, profile);
}

if (import.meta.main) {
  const flags = parseFlags(process.argv.slice(2), {
    output: { type: "string" },
    help: { type: "boolean" },
  });
  if (flags.help) {
    console.log("bun server/tools/check-meso-explosion.js [--output DIR]");
  } else {
    const report = await isolatedOnlineCheck({
      seed,
      run: runMesoExplosion,
      output: flags.output ?? "/tmp/openms-meso-explosion",
    });
    console.log(
      JSON.stringify({ status: report.status, failure: report.failure }),
    );
    process.exitCode = report.status === "pass" ? 0 : 1;
  }
}
