import { MARKET_LIMITS } from "../../shared/market-protocol.js";
import { marketHeld, marketRequire } from "./market-state.js";

/** Search index only. Listings remain part of the locked owner profile; items have one canonical row. */
export async function persistMarket(tx, database, entry, profiles) {
  const before = profiles.before.onlineState?.market?.listings ?? [];
  const after = profiles.after.onlineState?.market?.listings ?? [];
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await tx`DELETE FROM market_listing WHERE owner_id=${entry.characterId}`;
    for (const row of after) {
      await tx`INSERT INTO market_listing(id,owner_id,kind,item_id,price,expires_at,realm,summary) VALUES(${row.id},${entry.characterId},${row.kind},${row.itemId},${row.price},${row.expiresAt},${row.realm},${row})`;
    }
  }
  const delta = marketHeld(profiles.after) - marketHeld(profiles.before);
  if (delta) {
    await database.ledgerPair(tx, {
      ...entry,
      characterId: `market:${entry.characterId}`,
      asset: "prepaid",
      delta,
    });
  }
}

export async function marketListing(database, listingId) {
  const rows =
    await database.sql`SELECT owner_id,summary FROM market_listing WHERE id=${listingId}`;
  marketRequire(rows.length === 1, "NOT_FOUND");
  return { ...rows[0].summary, ownerId: rows[0].owner_id };
}

/** Parameterized, paged search. Never scan saved profiles or serve private actor state to browsers. */
export async function marketSearch(database, actor, query) {
  const own = query.tab === "mine";
  const cart = query.tab === "cart";
  const wanted = ["sale", "wanted", "auction"].includes(query.tab)
    ? query.tab
    : null;
  const cartIds = actor.profile.onlineState?.market?.cart ?? [];
  const itemIds = query.itemIds ?? [];
  const category = query.category ?? 0;
  const rows =
    await database.sql`SELECT l.owner_id,l.summary,c.profile->>'name' AS owner_name,i.data AS item
    FROM market_listing l JOIN character c ON c.id=l.owner_id
    LEFT JOIN item_instance i ON i.owner_id=l.owner_id AND i.location='market' AND i.container_id=l.id
    WHERE c.deleted_at IS NULL AND l.realm=${actor.realm} AND l.expires_at>${query.now}
      AND (${own}=false OR l.owner_id=${actor.id})
      AND (${cart}=false OR l.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(cartIds)}::text::jsonb)))
      AND (${wanted}::text IS NULL OR l.kind=${wanted})
      AND (${category}=0 OR (l.item_id>=${category * 1000000} AND l.item_id<${(category + 1) * 1000000}))
      AND (${query.query === ""}=true OR l.item_id IN (SELECT value::integer FROM jsonb_array_elements_text(${JSON.stringify(itemIds)}::text::jsonb)))
    ORDER BY l.id LIMIT ${MARKET_LIMITS.page + 1} OFFSET ${query.page * MARKET_LIMITS.page}`;
  return rows;
}

export async function dueMarketListings(database, now) {
  return database.sql`SELECT owner_id,summary FROM market_listing WHERE expires_at<=${now} ORDER BY expires_at,id LIMIT 8`;
}

export function marketHasProperty(profile) {
  const state = profile.onlineState?.market;
  return Boolean(
    state &&
    (state.listings.length ||
      state.transfer.length ||
      state.escrow.length ||
      state.incoming.length),
  );
}
