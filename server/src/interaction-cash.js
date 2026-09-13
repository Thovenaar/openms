import {
  cashPurchasePlan,
  deliverCashPurchase,
} from "../../client/src/items/cash-commerce.js";
import { admitActor, operationFor } from "./action-rules.js";
import {
  interactionReceipt,
  requireCharacterRevision,
  requireInteraction,
} from "./interaction-common.js";
import { cashRequire, giftCash, mutateCash } from "./interaction-cash-rules.js";

function admitCash(actor, message, world) {
  admitActor(actor, world, message.fieldEpoch);
  requireCharacterRevision(actor, message);
  requireInteraction(
    actor.profile.hp > 0 && !actor.tradeId && !actor.conversation,
    "CHARACTER_BUSY",
  );
  requireInteraction(
    !message.action.uid || !actor.itemLocks?.has(message.action.uid),
    "CHARACTER_BUSY",
  );
  requireInteraction(
    world.content.catalog.ui.cashShop?.commodities,
    "CONTENT_MISMATCH",
  );
}

async function recipients(actor, message, world) {
  const result = [];
  const seen = new Set();
  for (const name of message.action.names) {
    const id = await world.participants.resolve(name);
    cashRequire(
      id !== actor.id && !seen.has(id),
      "cash-recipient",
      "Choose different recipients other than yourself.",
    );
    seen.add(id);
    result.push(id);
  }
  const profiles = await world.participants.load(result);
  admitCash(actor, message, world);
  return interactionReceipt(actor.revision, {
    kind: "cash.recipients",
    recipients: result.map((id) => ({ id, name: profiles.get(id).name })),
  });
}

function quote(actor, message, world) {
  const request = message.action;
  const plan = cashPurchasePlan(
    actor.profile,
    world.content.catalog,
    request,
    Date.now(),
  );
  deliverCashPurchase(
    structuredClone(actor.profile),
    world.content.catalog,
    plan,
  );
  return interactionReceipt(actor.revision, {
    kind: "cash.quote",
    sn: request.sn,
    price: plan.price,
    currency: request.currency,
  });
}

export async function executeCash(actor, message, world) {
  admitCash(actor, message, world);
  if (message.action.kind === "cash.recipients")
    {return recipients(actor, message, world);}
  if (message.action.kind === "cash.quote") return quote(actor, message, world);
  const request = message.action;
  const ids = [actor.id];
  if (request.kind === "cash.gift") {
    for (const target of request.targetIds) {
      const id = await world.participants.resolve(target);
      cashRequire(
        id === target && !ids.includes(id),
        "cash-recipient",
        "Select different actual recipients.",
      );
      ids.push(id);
    }
  }
  const now = Date.now();
  const receipt = await world.participants.commit(
    actor,
    operationFor(message),
    ids,
    (profiles) => {
      admitCash(actor, message, world);
      if (request.kind === "cash.gift") {
        return giftCash(profiles, actor.id, {
          catalog: world.content.catalog,
          request,
          now,
        });
      }
      return mutateCash(
        profiles.get(actor.id),
        world.content.catalog,
        request,
        now,
      );
    },
  );
  if (receipt.status === "committed") await world.participants.publish(ids);
  return receipt;
}
