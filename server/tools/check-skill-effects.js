import { parseFlags } from "../../client/tools/source-options.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runSkillEffect } from "../../client/tools/scenarios/online-skill-effect.js";

/** Explicit fixture only: one learned self-cast skill bound to a native key. */
async function seed(database) {
  const passwordHash = await Bun.password.hash("password");
  const account = await database.createAccount({
    name: "caster",
    passwordHash,
    role: "player",
  });
  const profile = createProfile({
    mapId: "001000000",
    x: 520,
    y: 274,
    facing: 1,
  });
  profile.name = "Caster";
  profile.settings.BGM.mute = true;
  profile.skills[1001] = { level: 1, masterLevel: 0, expiresAt: null };
  profile.keyBindings.keys[32] = { type: 1, id: 1001 };
  await database.createCharacter(account.id, profile);
}

if (import.meta.main) {
  const flags = parseFlags(process.argv.slice(2), {
    output: { type: "string" },
    help: { type: "boolean" },
  });
  if (flags.help) {
    console.log(
      "bun server/tools/check-skill-effects.js [--output DIR]\nDefault: /tmp/openms-skill-effects. Disposable account/database; native skill cast, published visual and started Use voice.",
    );
  } else {
    const report = await isolatedOnlineCheck({
      seed,
      run: runSkillEffect,
      output: flags.output ?? "/tmp/openms-skill-effects",
    });
    console.log(
      JSON.stringify({ status: report.status, failure: report.failure }),
    );
    process.exitCode = report.status === "pass" ? 0 : 1;
  }
}
