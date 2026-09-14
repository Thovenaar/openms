import { shopRows } from "../../client/src/npc/npc-shop-rules.js";
import { interactionState, requireInteraction } from "./interaction-common.js";
import { admitAuthoredDialogue } from "./interaction-npc-authored.js";

const MAX_ROUTES = 10000;
const MAX_SHOP_ROWS = 200000;

function indexRows(rows, key) {
  requireInteraction(
    Array.isArray(rows) && rows.length <= MAX_ROUTES,
    "CONTENT_MISMATCH",
  );
  const table = new Map();
  for (const row of rows) {
    requireInteraction(
      Number.isSafeInteger(row[key]) && row[key] > 0 && !table.has(row[key]),
      "CONTENT_MISMATCH",
    );
    table.set(row[key], row);
  }
  return table;
}

export async function npcReferences(world) {
  const state = interactionState(world);
  if (state.references) return state.references;
  const descriptor = world.content.catalog.serverData?.datasets?.shops;
  requireInteraction(descriptor, "CONTENT_MISMATCH");
  const data = await world.content.json(descriptor);
  requireInteraction(
    data.schemaVersion === 2 &&
      data.domain === "shops" &&
      data.routing?.nameOverride?.operator === "ends-with",
    "CONTENT_MISMATCH",
  );
  requireInteraction(
    Array.isArray(data.tables?.shopitems) &&
      data.tables.shopitems.length <= MAX_SHOP_ROWS,
    "CONTENT_MISMATCH",
  );
  const references = {
    data,
    routes: indexRows(data.npcRoutes, "npcId"),
    shops: indexRows(data.shopIndex, "shopId"),
  };
  state.references = references;
  return references;
}

/**
 * Runtime precedence, extending the compiled NPC_ROUTING_POLICY precedence
 * (client/tools/npc-script-routes.js) with an authored overlay between the
 * name override and the compiled numeric script:
 * duey -> gachapon -> maple-tv-name -> authored-dialogue -> numeric-script ->
 * standard-shop-fallback. The two hard-coded policy routes and the Maple TV
 * name override keep their original authority over authored dialogue.
 */
export function resolveNpcRoute(references, npc, catalog) {
  const route = references.routes.get(npc.templateId);
  if (route && ["duey", "gachapon"].includes(route.precedence)) return route;
  const override = references.data.routing.nameOverride;
  const name = catalog.quests.strings.npc[npc.templateId];
  requireInteraction(
    typeof name === "string" && name.length > 0,
    "CONTENT_MISMATCH",
  );
  if (name.endsWith(override.value)) {
    const named = references.data.namedScripts?.[override.script];
    requireInteraction(named, "CONTENT_MISMATCH");
    return named;
  }
  const dialogue = admitAuthoredDialogue(catalog.dialogues?.[npc.templateId]);
  if (dialogue) {
    return {
      status: "supported",
      precedence: "authored-dialogue",
      npcId: npc.templateId,
      dialogue,
    };
  }
  return route ?? null;
}

export function literalShopRows(references, shopId) {
  const shop = references.shops.get(shopId);
  requireInteraction(
    shop && Array.isArray(shop.itemRows) && shop.itemRows.length <= 8192,
    "CONTENT_MISMATCH",
  );
  const rows = [];
  for (const sourceRow of shop.itemRows) {
    requireInteraction(
      Number.isSafeInteger(sourceRow) && sourceRow >= 0,
      "CONTENT_MISMATCH",
    );
    const row = references.data.tables.shopitems[sourceRow];
    requireInteraction(row?.shopid === shopId, "CONTENT_MISMATCH");
    rows.push({
      shopId,
      itemId: row.itemid,
      price: row.price,
      pitch: row.pitch,
      position: row.position,
      sourceRow,
    });
  }
  return shopRows({ shopId, rows });
}

export async function npcEnvironment(world, lease, references, route) {
  const catalog = world.content.catalog;
  let inventory = null;
  if (
    route.requirements?.includes(
      "quest-state-only-definition:no-timers-no-custom-progress-no-repeat-counters",
    )
  ) {
    requireInteraction(catalog.quests.inventory, "CONTENT_MISMATCH");
    inventory = await world.content.json(catalog.quests.inventory);
  }
  const artworkMetadata = catalog.ui.dialogArtwork ?? {};
  const paths = Object.entries(artworkMetadata);
  requireInteraction(paths.length <= 10000, "CONTENT_MISMATCH");
  const artwork = new Set();
  for (const [path, record] of paths) if (record.descriptor) artwork.add(path);
  return {
    npcId: lease.npcTemplateId,
    items: catalog.ui.items,
    quests: { ...catalog.quests, inventory },
    names: catalog.quests.strings,
    mapNames: catalog.mapNames,
    portraits: catalog.ui.npcPortraits,
    shops: references.shops,
    artwork,
    artworkMetadata,
    storageAvailable:
      typeof world.openStorage === "function" &&
      Boolean(catalog.ui.npcPortraits[lease.npcTemplateId]?.storage) &&
      Boolean(catalog.ui.bundles.Trunk),
  };
}
