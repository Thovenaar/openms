import { join } from "node:path";
import { parseFlags } from "../../client/tools/source-options.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { DelayedTraffic } from "../../client/tools/scenarios/delayed-traffic.js";
import { runCombatLatency } from "../../client/tools/scenarios/online-combat-latency.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";

async function seed(database) {
  await seedCharacter(database, "fighter", 100, 1001004);
  await seedCharacter(database, "mage", 200, 2001004);
}

async function seedCharacter(database, name, job, skillId) {
  const account = await database.createAccount({
    name,
    passwordHash: await Bun.password.hash("password"),
    role: "player",
  });
  const profile = createProfile({
    mapId: "000050000",
    x: 200,
    y: 335,
    facing: 1,
  });
  profile.name = name;
  profile.job = job;
  if (job === 200) {
    profile.equipment.find((item) => item.slot === -11).id = 1372005;
  }
  profile.level = 20;
  profile.baseMaxHP = profile.maxHP = profile.hp = 5000;
  profile.baseMaxMP = profile.maxMP = profile.mp = 1000;
  profile.skills[skillId] = { level: 1, masterLevel: 0, expiresAt: null };
  profile.keyBindings.keys[32] = { type: 1, id: skillId };
  profile.settings.BGM.mute = true;
  await database.createCharacter(account.id, profile);
}

if (import.meta.main) {
  const flags = parseFlags(process.argv.slice(2), {
    output: { type: "string" },
    baseline: { type: "boolean" },
    help: { type: "boolean" },
  });
  if (flags.help) {
    console.log(
      "bun server/tools/check-combat-latency.js [--output DIR] [--baseline]\n500 ms RTT, native attacks and skills, interrupted monster updates. Baseline records before-repair behavior without smoothness assertions.",
    );
  } else {
    const timings = {},
      output = flags.output ?? "/tmp/openms-combat-latency";
    const report = await isolatedOnlineCheck({
      seed,
      output,
      timings,
      network: new DelayedTraffic(500),
      run: (options) =>
        runCombatLatency({ ...options, baseline: Boolean(flags.baseline) }),
    });
    report.fixtureTimings = timings;
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        status: report.status,
        timings: report.timings,
        actions: report.actions,
        movement: report.movement,
        failure: report.failure,
      }),
    );
    process.exitCode = report.status === "pass" ? 0 : 1;
  }
}
