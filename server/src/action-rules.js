import {
  protocolError,
  canonicalAction,
  actionDomain,
  RESULT_CODES,
} from "../../shared/protocol.js";
import {
  admitItem,
  selectedItem,
} from "../../client/src/items/inventory-action-rules.js";
import { SOCIAL_RULE_CODES } from "../../shared/social-feedback.js";

/** Receipt identity includes the originally admitted field, never the actor's later destination. */
export function operationFor(message) {
  const digest = new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify({
        fieldEpoch: message.fieldEpoch,
        canonical: canonicalAction(message.action),
      }),
    )
    .digest("hex");
  return {
    operationId: message.operationId,
    digest,
    expectedRevision: message.expectedRevision,
    domain: actionDomain(message.action),
    kind: message.action.kind,
    fieldEpoch: message.fieldEpoch,
  };
}

/** Recheck live ownership; only the server transition mutator may admit its preparing state. */
export function admitActor(actor, world, fieldEpoch, transitioning = false) {
  if (!actor.session) throw protocolError("UNAUTHENTICATED");
  if (actor.session.revoked || actor.session.expiresAt <= Date.now()) {
    throw protocolError("SESSION_EXPIRED");
  }
  const lifecycle =
    actor.state === "active" ||
    (transitioning && actor.state === "transitioning");
  if (world.actors.get(actor.id) !== actor || !lifecycle) {
    throw protocolError("NOT_ALLOWED");
  }
  if (
    actor.field?.epoch !== fieldEpoch ||
    actor.field.characters.get(actor.id) !== actor
  ) {
    throw protocolError("STALE_FIELD");
  }
}

export function reject(code, reason) {
  const error = protocolError(code);
  error.message = reason;
  throw error;
}

/** Offline rule diagnostics stay server-side; only closed protocol codes cross the wire. */
export function ruleError(error) {
  if (error.code !== "OK" && RESULT_CODES.includes(error.code)) return error;
  if (Object.hasOwn(SOCIAL_RULE_CODES, error.code)) {
    return protocolError(SOCIAL_RULE_CODES[error.code]);
  }
  let code = "REQUIREMENTS_NOT_MET";
  if (
    ["inventory-full", "inventory-limit", "occupied-slot"].includes(error.code)
  ) {
    code = "INVENTORY_FULL";
  }
  if (["item-missing", "insufficient-items"].includes(error.code)) {
    code = "NOT_FOUND";
  }
  if (error.code === "insufficient-mesos") code = "INSUFFICIENT_FUNDS";
  if (["item-no-drop", "character-dead", "item-expired"].includes(error.code)) {
    code = "NOT_ALLOWED";
  }
  const result = protocolError(code);
  result.message = error.message;
  return result;
}

export function ownedItem(profile, actor, id, now) {
  const item = selectedItem(profile, id);
  admitItem(profile, item, now);
  if (actor.itemLocks?.has(item.uid) || (item.flags & 1) !== 0) {
    reject("NOT_ALLOWED", "The item is reserved or sealed.");
  }
  return item;
}

export function availableMesos(profile, actor) {
  if (profile.meso < (actor.tradeMesos ?? 0)) {
    reject("INSUFFICIENT_FUNDS", "Mesos are reserved by the current trade.");
  }
}

/** Server-owned random samples; no client seed. DB memoizes the complete plan on retry. */
export function createServerRandom() {
  const sample = new Uint32Array(1);
  return function random() {
    return crypto.getRandomValues(sample)[0] / 0x100000000;
  };
}

export function onlineState(profile) {
  profile.onlineState ??= { effects: [], cooldowns: {} };
  return profile.onlineState;
}
