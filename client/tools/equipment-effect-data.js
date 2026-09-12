import { at, value, resolveNode } from "../src/assets/image.js";
import { effectFrames } from "./audiovisual-data.js";
import { validateEquipmentEffectCatalog } from "../src/items/equipment-effect-model.js";

const MAX_SETS = 512;
const MAX_REQUIREMENTS = 52;
const MAX_ALTERNATIVES = 256;

/** 005d8acc reads SetEff/info slot alternatives;005d925d requires every populated group. */
function requirements(node) {
  const groups = Object.entries(at(node, "info").children);
  if (!groups.length || groups.length > MAX_REQUIREMENTS) {
    throw new Error("Equipment effect requirement bound exceeded");
  }
  return groups.map(([slot, group]) => {
    const ids = Object.values(resolveNode(group).children).map(
      (child) => child.value,
    );
    if (!ids.length || ids.length > MAX_ALTERNATIVES) {
      throw new Error("Equipment effect alternative bound exceeded");
    }
    return { slot: Number(slot), ids };
  });
}

async function publishLayer(context, id, node) {
  const source = `Effect.wz:SetEff.img/${id}/effect`;
  const effect = at(node, "effect");
  const metadata = {
    id,
    source,
    fixed: Number(value(effect, "fixed", 0)),
    pos: Number(value(effect, "pos", 0)),
    z: Number(value(effect, "z", 0)),
  };
  const { frames } = await effectFrames(context, effect);
  const entity = {
    id: `equipment-effect:${id}`,
    order: 0,
    kind: "effect",
    x: 0,
    y: 0,
    z: metadata.z,
    visible: true,
    flip: false,
    opacity: 1,
    action: "default",
    actions: { default: frames },
  };
  const descriptor = await context.bundle({
    id: entity.id,
    entities: [entity],
    metadata: { equipmentEffect: metadata },
  });
  return { ...metadata, descriptor };
}

/** Demand-loaded original set effects; only sets satisfiable by the release's item/appearance closure.
 * ItemEff rings require another character's matching relationship, not merely local equip.
 * CharacterEff's particle definitions are not the SetEff consumer and must not be substituted. */
export async function extractEquipmentEffects(context, wanted) {
  const root = context.image("Effect", "SetEff.img");
  const sets = Object.entries(root.children);
  if (sets.length > MAX_SETS) {
    throw new Error("Equipment effect catalog bound exceeded");
  }
  const entries = [];
  for (const [key, original] of sets) {
    const node = resolveNode(original);
    if (!node.children.effect || value(node, "multipet", 0)) continue;
    const groups = requirements(node);
    if (!groups.every((group) => group.ids.some((id) => wanted.has(id)))) {
      continue;
    }
    entries.push({
      ...(await publishLayer(context, Number(key), node)),
      cash: Number(value(node, "cash", 0)),
      requirements: groups,
    });
  }
  const catalog = { schemaVersion: 1, entries };
  validateEquipmentEffectCatalog(catalog);
  return catalog;
}
