import {
  isPickupItem,
  applyAlchemist,
} from "../../client/src/items/item-effects.js";
import {
  inspectPickupEffect,
  admitPickupEffect,
  applyPickupVitals,
} from "../../client/src/world/pickup-effects.js";
import { installItemEffect } from "./action-character.js";
import { onlineState, reject } from "./action-rules.js";
import {
  pickupConditionContext,
  refreshPickupConditions,
} from "./drop-conditions.js";

/** Reserve original temporary-state capacity and validate real source metadata before any credit. */
export async function preparePickupEffect(world, actor, drop) {
  const itemId = drop.item?.id ?? 0;
  if (
    !itemId ||
    (!isPickupItem(world.content.items[itemId]) &&
      Math.floor(itemId / 10000) !== 238)
  )
    {return null;}
  const effect = inspectPickupEffect(
    { itemId, quantity: drop.item.count, instance: drop.item },
    world.content.items,
  );
  if (!actor.skills || actor.skills.destroyed)
    {reject(
      "REQUIREMENTS_NOT_MET",
      "Pickup skill-effect authority is unavailable.",
    );}
  applyAlchemist(effect, actor.skills);
  const authority = actor.skills.effects;
  const context = { ...refreshPickupConditions(actor) };
  admitPickupEffect(effect, context);
  const prepared = {
    itemId,
    effect,
    authority,
    context,
    field: actor.field,
    reservation: null,
    resource: actor.skills.resources,
    sourcePrepared: false,
    published: false,
    row: null,
  };
  try {
    if (effect.state) {
      prepared.reservation = authority.reserve(effect.state);
      await prepared.resource.prepareSource("item", itemId);
      prepared.sourcePrepared = true;
    }
    admitPreparedPickup(actor, prepared);
    return prepared;
  } catch (error) {
    releasePickupEffect(prepared);
    throw error;
  }
}

function admitPreparedPickup(actor, prepared) {
  const current = pickupConditionContext(actor);
  if (
    actor.field !== prepared.field ||
    actor.skills.effects !== prepared.authority ||
    prepared.authority.destroyed ||
    prepared.published ||
    current.mapId !== prepared.context.mapId ||
    current.partyHunting !== prepared.context.partyHunting ||
    (prepared.reservation &&
      prepared.authority.reservation !== prepared.reservation)
  ) {
    reject(
      "NOT_ALLOWED",
      "Pickup conditions or temporary-state ownership changed.",
    );
  }
}

/** Shared card/pickup semantics and item timer publication share the entitlement transaction. */
export function applyPickupEffect(profile, actor, prepared, now) {
  if (!prepared) return null;
  admitPreparedPickup(actor, prepared);
  const hp = profile.hp;
  const mp = profile.mp;
  applyPickupVitals(profile, prepared.effect, prepared.context);
  if (prepared.effect.state) {
    prepared.row = installItemEffect(
      onlineState(profile),
      prepared.effect.state.id,
      prepared.effect,
      now,
    );
    prepared.effect.state.expiresAt = prepared.row.expiresAt;
  }
  return {
    itemId: prepared.itemId,
    hp: profile.hp - hp,
    mp: profile.mp - mp,
    effectId: prepared.row?.id ?? null,
    duration: prepared.row?.duration ?? 0,
  };
}

/** Infallible state swap only after the same DB commit that consumes the ground entitlement. */
export function publishPickupEffect(prepared) {
  if (!prepared || prepared.published) return;
  if (prepared.reservation) prepared.authority.publish(prepared.reservation);
  prepared.published = true;
}

export function releasePickupEffect(prepared) {
  if (!prepared || prepared.published) return;
  if (prepared.reservation) prepared.authority.abort(prepared.reservation);
  if (prepared.sourcePrepared)
    {prepared.resource.releaseSource("item", prepared.effect.state.id);}
}
