import {
  buyQuote,
  sellQuote,
  rechargeQuote,
  applyShopQuote,
  shopTemplate,
} from "../../client/src/npc/npc-shop-rules.js";
import { literalShopRows, npcReferences } from "./interaction-npc-content.js";
import {
  currentNpc,
  publishInteraction,
  requireInteraction,
  INTERACTION_LIMITS,
} from "./interaction-common.js";
import { operationFor } from "./action-rules.js";

/** Versioned reference shop policy: SQL rows are unlimited stock, mesos only. */
export async function admitShop(world, shopId) {
  const references = await npcReferences(world);
  const rows = literalShopRows(references, shopId);
  for (const row of rows) {
    requireInteraction(row.pitch === 0, "CONTENT_MISMATCH");
    shopTemplate(world.content.items, row.itemId);
  }
  return rows;
}

export async function openShop(actor, world, lease, shopId) {
  const rows = await admitShop(world, shopId);
  currentNpc(world, actor, lease);
  lease.view = { kind: "shop", shopId, npcId: lease.npcTemplateId };
  const session = {
    id: lease.id,
    npcId: lease.npcId,
    npcTemplateId: lease.npcTemplateId,
    fieldEpoch: lease.fieldEpoch,
    expiresAt: lease.expiresAt,
    revision: lease.step,
    rows: new Map(),
    shopId,
  };
  for (const row of rows) session.rows.set(row.sourceRow, row);
  actor.shop = session;
  const parts = Math.max(1, Math.ceil(rows.length / 128));
  for (let part = 0; part < parts; part++) {
    const offered = rows.slice(part * 128, (part + 1) * 128).map((row) => ({
      rowId: row.sourceRow,
      templateId: row.itemId,
      unitPrice: row.price,
      stock: null,
    }));
    publishInteraction(world, actor, {
      kind: "shop",
      shopSession: session.id,
      npcId: session.npcId,
      npcTemplateId: session.npcTemplateId,
      revision: session.revision,
      part,
      parts,
      rows: offered,
    });
  }
}

export async function executeShop(actor, message, world) {
  const session = actor.shop;
  currentNpc(world, actor, session);
  const action = message.action;
  requireInteraction(session.id === action.shopSession, "SESSION_EXPIRED");
  requireInteraction(
    !action.itemId || !actor.itemLocks?.has(action.itemId),
    "CHARACTER_BUSY",
  );
  const receipt = await world.participants.commit(
    actor,
    operationFor(message),
    [actor.id],
    async (profiles) => {
      const draft = profiles.get(actor.id);
      currentNpc(world, actor, session);
      requireInteraction(
        actor.shop === session && session.id === action.shopSession,
        "SESSION_EXPIRED",
      );
      const quote = shopQuote(draft, world.content.items, session, action);
      applyShopQuote(draft, quote);
      const value = {
        kind: "shop.transaction",
        shopSession: session.id,
        action: quote.kind,
        itemId: quote.itemId,
        uid: quote.uid,
        count: quote.units,
        amount: quote.amount,
        currency: quote.currency,
      };
      if (quote.kind !== "buy") return { value };
      return {
        value,
        itemSources: {
          [quote.uid]: {
            source: "shop",
            sourceId: String(session.shopId),
            mapId: Number(actor.profile.location.mapId),
            detail: {
              npcId: session.npcId,
              rowId: action.rowId,
              count: quote.units,
            },
          },
        },
      };
    },
  );
  if (receipt.status === "committed") {
    session.expiresAt = Date.now() + INTERACTION_LIMITS.leaseMs;
    if (actor.conversation?.id === session.id) {
      actor.conversation.expiresAt = session.expiresAt;
    }
    world.publish(actor, { type: "snapshot-request" });
  }
  return receipt;
}

function shopQuote(draft, items, session, action) {
  if (action.kind === "shop.buy") {
    const row = session.rows.get(action.rowId);
    requireInteraction(row, "NOT_FOUND");
    return buyQuote(draft, items, row, action.quantity);
  }
  if (action.kind === "shop.sell") {
    return sellQuote(draft, items, action.itemId, action.quantity);
  }
  if (action.kind === "shop.recharge") {
    return rechargeQuote(draft, items, action.itemId);
  }
  requireInteraction(false, "INVALID_MESSAGE");
}
