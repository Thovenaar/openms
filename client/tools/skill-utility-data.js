import { at, resolveNode } from "../src/assets/image.js";
import { effectFrames } from "./audiovisual-data.js";

const MAX_PET_TEMPLATES = 512;
const MAX_PET_ACTIONS = 128;

/** Native0070a9c3 and0040e1a5 load original Item/Pet frames; no synthetic pet sprites. */
export async function extractSkillUtility(context, items) {
  const pets = {};
  let count = 0;
  for (const item of Object.values(items)) {
    if (item.category !== "Pet") continue;
    if (++count > MAX_PET_TEMPLATES) {
      throw new Error("Pet template extraction bound exceeded");
    }
    const root = context.image("Item", `Pet/${item.id}.img`);
    const actions = {};
    const names = Object.keys(root.children);
    if (names.length > MAX_PET_ACTIONS) {
      throw new Error("Pet action bound exceeded");
    }
    for (const name of names) {
      const node = resolveNode(at(root, name));
      if (node.type !== "Property" || !node.children["0"]) continue;
      if (resolveNode(node.children["0"]).type !== "Canvas") continue;
      actions[name] = (await effectFrames(context, node)).frames;
    }
    if (!actions.stand0 && !actions.stand1) {
      throw new Error(`Original pet stand action absent: ${item.id}`);
    }
    const entity = {
      id: `pet:${item.id}`,
      order: 0,
      kind: "effect",
      x: 0,
      y: 0,
      z: 0,
      visible: true,
      flip: false,
      opacity: 1,
      action: actions.stand0 ? "stand0" : "stand1",
      actions,
    };
    const source = `Item.wz:Pet/${item.id}.img`;
    pets[item.id] = {
      source,
      bundle: await context.bundle({
        id: entity.id,
        entities: [entity],
        metadata: { source },
      }),
    };
  }
  return { pets };
}
