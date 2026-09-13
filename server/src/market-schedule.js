import { dueMarketListings, marketListing } from "./database-market.js";
import { marketState } from "./market-state.js";
import { expireMarketOrder } from "./market-orders.js";
import { combatOperation } from "./combat-rewards.js";
import { publishMarketChange } from "./interaction-market.js";

/** Restart-safe expiry: SQL deadlines are authoritative; eight due lots per five-second batch. */
export function advanceMarketSchedule(world) {
  if (
    world.closed ||
    world.marketTask ||
    world.now < (world.marketNextAt ?? 0)
  ) {
    return;
  }
  const actor = activeAnchor(world);
  if (!actor) return;
  world.marketNextAt = world.now + 5000;
  world.marketTask = settleDue(world, actor)
    .catch((error) => {
      world.log?.("market.expiry.failed", {
        code: error.code ?? "SERVER_BUSY",
      });
    })
    .finally(() => {
      world.marketTask = null;
    });
}

function activeAnchor(world) {
  for (const actor of world.actors.values()) {
    if (actor.state === "active" && !actor.retiring && !actor.deliveryError) {
      return actor;
    }
  }
  return null;
}

async function settleDue(world, actor) {
  const due = await dueMarketListings(world.database, world.now);
  for (const row of due) {
    if (world.closed || actor.retiring || actor.state !== "active") return;
    const current = await marketListing(world.database, row.summary.id);
    const ids = [current.ownerId, ...(current.bid ? [current.bidderId] : [])];
    const operation = combatOperation(actor, "mts.expire");
    const receipt = await world.participants.commitProduced(
      actor,
      operation,
      () => ids,
      (drafts) => {
        const state = marketState(drafts.get(current.ownerId));
        const listing = state.listings.find((entry) => entry.id === current.id);
        if (
          listing &&
          listing.expiresAt <= world.now &&
          listing.bidderId === current.bidderId &&
          listing.bid === current.bid
        ) {
          expireMarketOrder(drafts, listing, current.ownerId);
        }
        return {
          value: {
            kind: "mts.changed",
            action: "expire",
            listingId: current.id,
          },
        };
      },
    );
    if (receipt.status === "committed") {
      publishMarketChange(world, current.realm, receipt.value);
    }
  }
}
