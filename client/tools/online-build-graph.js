import { relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";

const MAX_GRAPH_FILES = 16384;
const FORBIDDEN = new Set([
  "src/main.js",
  "src/ingame.js",
  "src/delivery/offline-delivery.js",
  "src/profile/profile-store.js",
  "src/combat/offline-field.js",
  "src/combat/offline-mobs.js",
  "src/items/item-use.js",
  "src/items/inventory-actions.js",
  "src/items/cash-shop.js",
  "src/quests/quest-system.js",
  "src/skills/skill-system.js",
  "src/world/drop-system.js",
  "src/world/reactor-system.js",
  "src/world/pickup-effects.js",
  "src/npc/npc-interactions.js",
  "src/npc/npc-shop.js",
  "src/npc/npc-storage.js",
  "src/npc/npc-script-authority.js",
  "src/social/local-social.js",
  "src/social/local-chat.js",
  "src/social/local-trade.js",
]);

/** Bun's resolved module loads are the build graph, including transitive/aliased imports. */
export function onlineBuildGraph(root) {
  const inputs = new Set();
  return {
    inputs,
    plugin: {
      name: "online-authority-boundary",
      setup(build) {
        build.onLoad({ filter: /./, namespace: "file" }, async (args) => {
          const filename = await realpath(args.path);
          const path = relative(resolve(root), filename).replaceAll("\\", "/");
          if (FORBIDDEN.has(path) || path.startsWith("src/offline/")) {
            throw new Error(`Online graph imports local authority: ${path}`);
          }
          inputs.add(filename);
          if (inputs.size > MAX_GRAPH_FILES) {
            throw new Error("Online module graph capacity exceeded");
          }
          // Returning nothing preserves Bun's normal loader; this guard never rewrites source.
        });
      },
    },
  };
}
