import { blockScript } from "./npc-script-ir.js";
import { npcOutputsWithinLimit } from "../src/npc/npc-script-output.js";

/** Static straight-line checks; bounded calls retain the VM's atomic output guard. */
export function validateCallbackOutputs(context, program, root) {
  if (!npcOutputsWithinLimit(program)) {
    blockScript(
      context,
      root,
      "A callback can emit multiple dialogs/shops; ordered multi-packet presentation is unsupported",
    );
  }
}
