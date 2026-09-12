import { join } from "node:path";
import {
  clickNpc,
  groundAt,
  mapManifest,
  npcPlacement,
  seededProfile,
  settled,
  TIMEOUT,
} from "./native.js";

const MAP = "104000001";
const NPC = 1001001;
const SHOP = '.maple-ui-panel[aria-label="Shop"]';

async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const npc = npcPlacement(manifest, NPC);
  return {
    profile: seededProfile(catalog, {
      mapId: MAP,
      x: npc.authored.x,
      y: groundAt(manifest, npc.authored.fh, npc.authored.x),
      facing: -1,
    }),
    provenance: {
      kind: "seeded-not-earned",
      recipe: 1,
      source: npc.source,
      policy:
        "Canonical beginner and original shop-room location only; native NPC input opens the real shop without purchases or profile injection.",
    },
  };
}

async function run(context) {
  const { page, catalog, loadJSON, assert, checkpoint, output } = context;
  await settled(page, MAP);
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const npc = npcPlacement(manifest, NPC);
  const name = manifest.life.templates[npc.template].name;
  await clickNpc(page, npc);
  await page.waitForSelector(SHOP, { visible: true, timeout: TIMEOUT });
  await page.waitForNetworkIdle({ idleTime: 200, timeout: TIMEOUT });
  const groups = await page.$$eval(`${SHOP} [role="group"]`, (elements) =>
    elements.map((element) => ({
      label: element.getAttribute("aria-label"),
      visibleText: element.textContent,
    })),
  );
  assert(
    groups.some((group) => group.label?.endsWith(name)),
    "The original seller identity remains accessible in the native shop",
    { name, groups },
  );
  await checkpoint("original-shop-portrait-and-seller-identity");
  await page.screenshot({
    path: join(output, "npc-shop-portrait-and-name.png"),
  });
  return { mapId: MAP, npcId: NPC, name, groups };
}

export default {
  name: "npc-shop-name",
  recipe: 1,
  mapIds: [MAP],
  dependencies: [
    "client/tools/scenarios/{native,npc-shop-name}.js",
    "client/src/ui/ui-shop.js",
    "client/src/npc/**/*.js",
    "client/src/ingame*.js",
  ],
  fixture,
  run,
};
