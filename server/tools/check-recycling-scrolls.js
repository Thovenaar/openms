import { parseFlags } from "../../client/tools/source-options.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { grantItem } from "../../client/src/items/inventory-model.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runRecyclingScrolls } from "../../client/tools/scenarios/online-recycling-scrolls.js";

/** Detached active quest, unmodified starter gear and one real 100% scroll; no RNG override. */
async function seed(database, content) {
  const passwordHash = await Bun.password.hash("password");
  for (const name of ["recycler", "observer", "plant"]) {
    const account = await database.createAccount({
      name,
      passwordHash,
      role: "player",
    });
    const profile = createProfile({
      mapId: name === "plant" ? "101010100" : "001000000",
      x: name === "plant" ? -1027 : 520,
      y: name === "plant" ? 2024 : 274,
      facing: 1,
    });
    profile.name = {
      recycler: "Recycling",
      observer: "Observer",
      plant: "Botanist",
    }[name];
    profile.settings.BGM.mute = true;
    if (name === "recycler") {
      profile.quests[1008] = { state: 1, kills: {} };
      grantItem(profile, content.items[2043000], 1);
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
      "bun server/tools/check-recycling-scrolls.js [--output DIR]\nDefault: /tmp/openms-recycling-scrolls. Disposable database; two isolated clients; native reactor, pickup, quest, scrolling and HUD controls.",
    );
  } else {
    const report = await isolatedOnlineCheck({
      seed,
      run: runRecyclingScrolls,
      output: flags.output ?? "/tmp/openms-recycling-scrolls",
    });
    console.log(
      JSON.stringify({ status: report.status, failure: report.failure }),
    );
    process.exitCode = report.status === "pass" ? 0 : 1;
  }
}
