import { at, value } from "../src/assets/image.js";
import { extractTemplateActions, fields } from "./life-data.js";

/** Native0066d6d4 selects0x18705, not the ordinary blue-snail100100 template. */
export async function extractSkillTargets(context) {
  const source = "Mob.wz:0100101.img";
  const root = context.image("Mob", "0100101.img");
  const { actions, actionMetadata } = await extractTemplateActions(
    context,
    root,
    "mob",
  );
  const entity = {
    id: "doom:100101",
    order: 0,
    kind: "effect",
    x: 0,
    y: 0,
    z: 239991,
    visible: true,
    flip: false,
    opacity: 1,
    action: "stand",
    actions,
  };
  const info = at(root, "info");
  return {
    doom: {
      source,
      templateId: 100101,
      transitionMs: 1200,
      info: fields(info),
      actions: actionMetadata,
      speed: value(info, "speed", 0),
      flySpeed: value(info, "flySpeed", 0),
      bundle: await context.bundle({
        id: entity.id,
        entities: [entity],
        metadata: { source },
      }),
    },
  };
}
