import { validateProfile } from "../../src/profile/profile-validation.js";
import {
  clickNpc,
  dialogueStep,
  groundAt,
  mapManifest,
  npcPlacement,
  player,
  seededProfile,
  settled,
  viewNpc,
} from "./native.js";

export const ORIGIN = "541000000";
export const DESTINATION = "550000000";
const FEE = 10000;

export async function tourFixture({ catalog, loadJSON }) {
  const origin = await mapManifest(catalog, loadJSON, ORIGIN);
  const destination = await mapManifest(catalog, loadJSON, DESTINATION);
  const npc = npcPlacement(origin, 9000020);
  npcPlacement(destination, 9201135);
  const shops = await loadJSON(catalog.serverData.datasets.shops);
  const scriptSources = [];
  for (const id of [9000020, 9201135]) {
    const route = shops.npcRoutes.find((entry) => entry.npcId === id);
    if (route?.status !== "supported") {
      throw new Error(
        `Required authored World Tour route ${id} is not supported: ${route?.blockers?.[0]?.reason}`,
      );
    }
    scriptSources.push(route.source);
  }
  const x = npc.authored.x;
  const profile = seededProfile(catalog, {
    mapId: ORIGIN,
    x,
    y: groundAt(origin, npc.authored.fh, x),
    facing: -1,
  });
  profile.meso = 50000;
  validateProfile(profile, catalog.ui.items);
  return {
    profile,
    provenance: {
      kind: "seeded-not-earned",
      recipe: 1,
      grants: { meso: 50000 },
      locationSource: npc.source,
      scripts: scriptSources,
      policy:
        "Production createProfile and validation; authored Malaysia World Tour, no seeded saved location.",
    },
  };
}

export async function outbound(context, talkWithKeyboard = false) {
  const { page, catalog, loadJSON, checkpoint, assert, snapshot } = context;
  const manifest = await mapManifest(catalog, loadJSON, ORIGIN);
  await checkpoint("before-authored-world-tour-outbound");
  if (talkWithKeyboard) await page.keyboard.press("Space");
  else await clickNpc(page, npcPlacement(manifest, 9000020));
  await dialogueStep(page, '[aria-label="Next"]');
  await dialogueStep(page, '[data-quest-choice="0"]');
  await dialogueStep(page, '[aria-label="Next"]');
  await dialogueStep(page, '[aria-label="Next"]');
  await settled(page, DESTINATION);
  const state = await snapshot();
  assert(
    player(state).savedLocations.WORLDTOUR === Number(ORIGIN),
    "Authored outbound handler saves the actual origin map",
    {
      actual: player(state).savedLocations.WORLDTOUR,
      expected: Number(ORIGIN),
    },
  );
  await checkpoint("after-authored-world-tour-outbound");
  return state;
}

async function run(context) {
  const { page, catalog, loadJSON, snapshot, assert, checkpoint, inputs } =
    context;
  await settled(page, ORIGIN);
  const before = await snapshot();
  assert(
    player(before).savedLocations.WORLDTOUR === null,
    "Fixture did not preseed the return location",
  );
  const away = await outbound(context);
  assert(
    player(away).meso === player(before).meso - FEE,
    "Outbound debits the authored10000meso fee exactly once",
  );
  const destination = await mapManifest(catalog, loadJSON, DESTINATION);
  const returnNpc = npcPlacement(destination, 9201135);
  await viewNpc(page, returnNpc);
  await checkpoint("before-authored-malaysia-return");
  await clickNpc(page, returnNpc);
  await dialogueStep(page, '[data-quest-choice="1"]');
  await dialogueStep(page, '[aria-label="Next"]');
  await settled(page, ORIGIN);
  const returned = await snapshot();
  const returnPortal = await assertTourReturn(context, before, returned);
  await checkpoint("after-authored-malaysia-return");
  return {
    provenance: inputs.fixture.provenance,
    maps: [before.currentMap, away.currentMap, returned.currentMap],
    mesos: [player(before).meso, player(away).meso, player(returned).meso],
    returnPortal,
    location: player(returned).location,
    cameraPolicy:
      "Trusted native inspector camera buttons only; no player/world mutation or agent gameplay commands.",
  };
}

async function assertTourReturn(context, before, returned) {
  const { catalog, loadJSON, assert } = context;
  const origin = await mapManifest(catalog, loadJSON, ORIGIN);
  const authored = origin.physics.portals.find((entry) => entry.id === 4);
  const portal =
    authored ?? origin.physics.portals.find((entry) => entry.id === 0);
  assert(Boolean(portal), "Return resolves an authored arrival portal");
  assert(
    returned.currentMap === before.currentMap,
    "Return restores the original map",
  );
  assert(
    player(returned).meso === player(before).meso - FEE,
    "Free return preserves the post-outbound balance, without an invented refund",
  );
  assert(
    player(returned).savedLocations.WORLDTOUR === null,
    "Return consumes the typed saved location",
  );
  assert(
    player(returned).location.mapId === ORIGIN &&
      player(returned).location.x === portal.x,
    "Durable location restores the authored return portal, not the previous arbitrary feet position",
    {
      actual: player(returned).location,
      expected: { mapId: ORIGIN, portalId: portal.id, x: portal.x },
    },
  );
  assert(
    !returned.inGame.ui.windows.includes("UtilDlgEx"),
    "Field-bound return dialogue retires on commit",
  );
  return { requested: 4, resolved: portal.id, fallbackToZero: !authored };
}

export default {
  name: "world-tour-return",
  recipe: 1,
  mapIds: [ORIGIN, DESTINATION],
  dependencies: [
    "client/tools/scenarios/{native,world-tour-return}.js",
    "client/src/main.js",
    "client/src/npc/**/*.js",
    "client/src/world/{life-system,portal-system,field-transition}.js",
    "client/src/profile/**/*.js",
    "client/src/ui/{game-ui,quest-ui,ui-dialog-*}.js",
    "client/tools/npc-script-*.js",
    "client/tools/server-data.js",
  ],
  fixture: tourFixture,
  run,
};
