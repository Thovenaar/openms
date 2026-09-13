import { runSkillOperation } from "./field-skills.js";
import { admitActor, ownedItem, reject, ruleError } from "./action-rules.js";

/** Item-use owns the operation; the original pet controller owns its mutation and UUID. */
export async function executePetUse(actor, message, world, operation) {
  try {
    admitActor(actor, world, message.fieldEpoch);
    const item = admitPetUse(actor, message.action, world);
    const pets = actor.skills.utilityController.pets;
    const { receipt, value } = await runSkillOperation(
      world,
      actor,
      operation,
      () => pets.toggle(item.uid),
    );
    if (receipt) return receipt;
    const error = new Error(
      value?.reason ??
        "The original pet workflow did not commit an activation.",
    );
    error.code = value?.code;
    throw error;
  } catch (error) {
    throw ruleError(error);
  }
}

function admitPetUse(actor, action, world) {
  const item = ownedItem(actor.profile, actor, action.itemId, world.now);
  if (
    item.slot < 0 ||
    (action.target &&
      (action.target.kind !== "entity" || action.target.entityId !== actor.id))
  ) reject("NOT_ALLOWED", "Pet activation requires an owned inventory self-use item.");
  if (!actor.skills?.utilityController.pets || actor.skillPreparing)
    reject("NOT_ALLOWED", "The original pet controller is unavailable.");
  return item;
}
