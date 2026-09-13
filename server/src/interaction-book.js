import {
  isMonsterCard,
  monsterBookSummary,
} from "../../client/src/character/monster-book.js";
import { admitActor, operationFor } from "./action-rules.js";
import {
  requireCharacterRevision,
  requireInteraction,
} from "./interaction-common.js";

/** Public collection totals contain no peer inventory, balance, or full private profile. */
export function bookProjection(profile) {
  return monsterBookSummary(profile.monsterBook);
}

export async function executeBook(actor, message, world) {
  admitActor(actor, world, message.fieldEpoch);
  requireCharacterRevision(actor, message);
  requireInteraction(
    message.action.kind === "monster-book.cover",
    "INVALID_MESSAGE",
  );
  const itemId = message.action.itemId;
  requireInteraction(
    itemId === 0 ||
      (isMonsterCard(itemId) &&
        world.content.catalog.ui.monsterBook?.cards[itemId]),
    "CONTENT_MISMATCH",
  );
  const receipt = await world.participants.commit(
    actor,
    operationFor(message),
    [actor.id],
    (profiles) => {
      admitActor(actor, world, message.fieldEpoch);
      const draft = profiles.get(actor.id);
      requireInteraction(
        itemId === 0 || draft.monsterBook.cards[itemId] > 0,
        "REQUIREMENTS_NOT_MET",
      );
      const changed = draft.monsterBook.cover !== itemId;
      draft.monsterBook.cover = itemId;
      return { value: { kind: "monster-book.cover", changed, cover: itemId } };
    },
  );
  if (receipt.status === "committed")
    {await world.participants.publish([actor.id]);}
  return receipt;
}
