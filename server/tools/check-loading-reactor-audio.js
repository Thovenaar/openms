import { parseFlags } from "../../client/tools/source-options.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { isolatedOnlineCheck } from "./isolated-online-check.js";
import { runLoadingReactorAudio } from "../../client/tools/scenarios/online-loading-reactor-audio.js";

const fixtures = [];
/** Real map/weapon/reactor assets; mute BGM so the isolated hit's mixed PCM can prove audio. */
async function seed(database, content) {
  const passwordHash = await Bun.password.hash("password");
  for (const [name, mapId, x, y, placementId] of [
    ["boxaudio", "001000000", 565, 274, "reactor:0"],
    ["plantaudio", "101010100", -1027, 2024, "reactor:2"],
  ]) {
    const account = await database.createAccount({
      name,
      passwordHash,
      role: "player",
    });
    const profile = createProfile({ mapId, x, y, facing: 1 });
    profile.name = name;
    profile.settings.BGM.mute = true;
    if (name === "boxaudio") profile.quests[1008] = { state: 1, kills: {} };
    await database.createCharacter(account.id, profile);
    const map = await content.map(mapId);
    const placement = map.reactors.placements.find(
      (row) => row.id === placementId,
    );
    const sound = map.reactors.templates[placement.templateId].sounds[0];
    if (!sound) throw new Error(`Missing reactor hit descriptor: ${name}`);
    fixtures.push({
      name,
      mapId,
      placementId,
      sound,
      map: content.catalog.maps[mapId],
    });
  }
}

if (import.meta.main) {
  const flags = parseFlags(process.argv.slice(2), {
    output: { type: "string" },
    help: { type: "boolean" },
  });
  if (flags.help) {
    console.log(
      "bun server/tools/check-loading-reactor-audio.js [--output DIR]\nDefault: /tmp/openms-loading-reactor-audio. Disposable accounts; native cached equipment, map loading, box/plant hits and isolated real PCM.",
    );
  } else {
    const report = await isolatedOnlineCheck({
      seed,
      run: (options) => runLoadingReactorAudio({ ...options, fixtures }),
      output: flags.output ?? "/tmp/openms-loading-reactor-audio",
    });
    console.log(
      JSON.stringify({ status: report.status, failure: report.failure }),
    );
    process.exitCode = report.status === "pass" ? 0 : 1;
  }
}
