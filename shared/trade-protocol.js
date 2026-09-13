import {
  array,
  boolean,
  enumeration,
  id,
  nullable,
  number,
  record,
  revision,
  seq,
  string,
  union,
} from "./schema.js";

export const TRADE_CHAT_LENGTH = 256;
// Online transient transcript policies; neither is a durable conversation limit.
export const TRADE_CHAT_LINES = 64;
export const TRADE_CHAT_BYTES = 24576;
export const TRADE_TERMINAL_STATES = Object.freeze([
  "committed",
  "cancelled",
  "declined",
  "failed",
]);
const mesos = number(0, 2147483647);
const side = number(0, 1);
const slot = number(1, 9);
const diagnostic = string(/^[\s\S]*$/u, 512);
const resultCode = string(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u, 64);
const chatText = string(/^[\u0020-\u007e\u0080-\uffff]+$/u, TRADE_CHAT_LENGTH);
const offeredItem = record({
  itemId: id,
  quantity: number(1, 2147483647),
  slot,
});
const offerFields = {
  tradeId: id,
  items: array(offeredItem, 9, 0, (value) => value?.itemId),
  mesos,
};

/** Replace the old trade rows rather than registering duplicate action kinds. */
export const TRADE_ACTION_ROWS = Object.freeze([
  ["trade.invite", "character", { targetId: id }],
  ["trade.answer", "invitation", { invitationId: id, accept: boolean }],
  ["trade.offer", "trade", offerFields],
  ["trade.confirm", "trade", { tradeId: id }],
  ["trade.cancel", "trade", { tradeId: id }],
  ["trade.chat", "trade", { tradeId: id, text: chatText }],
]);
export const TRADE_EPHEMERAL_ACTIONS = Object.freeze([
  "trade.invite",
  "trade.answer",
  "trade.offer",
  "trade.cancel",
  "trade.chat",
]);

const resultBase = {
  kind: enumeration("trade.result"),
  tradeId: id,
  revision,
  participantIds: array(id, 2, 2, true),
};
const completed = record({
  ...resultBase,
  ok: enumeration(true),
  code: enumeration("trade-completed"),
  fees: array(mesos, 2, 2),
  netReceived: array(mesos, 2, 2),
});
const cancelledFields = {
  ...resultBase,
  ok: enumeration(true),
  side: nullable(side),
  reason: diagnostic,
};
const terminalResult = union("code", {
  "trade-completed": completed,
  "trade-cancelled": record({
    ...cancelledFields,
    code: enumeration("trade-cancelled"),
  }),
  "trade-declined": record({
    ...cancelledFields,
    code: enumeration("trade-declined"),
  }),
  "trade-failed": record({
    ...resultBase,
    ok: enumeration(false),
    code: enumeration("trade-failed"),
    cause: resultCode,
    reason: diagnostic,
  }),
});

export const TRADE_RESULT_SCHEMAS = Object.freeze({
  "trade.result": terminalResult,
  "trade.confirmed": record({
    kind: enumeration("trade.confirmed"),
    tradeId: id,
    revision,
    side,
  }),
  "trade.feedback": record({
    kind: enumeration("trade.feedback"),
    ok: enumeration(false),
    code: resultCode,
    reason: diagnostic,
  }),
});

/** Merge into the existing trade event and add slot to each offered-item record. */
export const TRADE_OFFER_ITEM_FIELDS = Object.freeze({ slot });
export const TRADE_EVENT_FIELDS = Object.freeze({
  state: enumeration("invited", "open", "confirmed", ...TRADE_TERMINAL_STATES),
  expiresAt: revision,
  messages: array(
    record({
      sequence: seq,
      side,
      name: string(/^[\s\S]*$/u, 32),
      text: chatText,
    }),
    TRADE_CHAT_LINES,
    0,
    (value) => value?.sequence,
  ),
  result: nullable(terminalResult),
});

function validTradeOffer(offer, ownerId) {
  if (
    offer?.ownerId !== ownerId ||
    !Array.isArray(offer.items) ||
    offer.items.length > 9
  ) {
    return false;
  }
  return new Set(offer.items.map((entry) => entry?.slot)).size === offer.items.length;
}

function validTradeParticipants(value) {
  for (const key of ["participants", "members", "offers"]) {
    if (!Array.isArray(value[key]) || value[key].length !== 2) return false;
  }
  for (let index = 0; index < 2; index++) {
    if (value.members[index]?.id !== value.participants[index]) return false;
    if (!validTradeOffer(value.offers[index], value.participants[index])) return false;
  }
  return true;
}

function validTradeMessages(messages) {
  if (!Array.isArray(messages) || messages.length > TRADE_CHAT_LINES) return false;
  let sequence = 0;
  for (const message of messages) {
    if (
      !message ||
      !Number.isSafeInteger(message.sequence) ||
      message.sequence <= sequence ||
      typeof message.text !== "string" ||
      message.text.length > TRADE_CHAT_LENGTH ||
      !message.text.trim()
    )
      {return false;}
    sequence = message.sequence;
  }
  return true;
}

/** Cross-record membership and consent invariants supplement the closed field schemas. */
export function validTradeEvent(value) {
  if (!validTradeParticipants(value) || !validTradeMessages(value.messages)) return false;
  const terminal = TRADE_TERMINAL_STATES.includes(value.state);
  if (terminal !== (value.result !== null)) return false;
  return !terminal || validTerminalResult(value);
}

function validTerminalResult(value) {
  const result = value.result;
  if (
    !result ||
    result.tradeId !== value.tradeId ||
    result.revision !== value.revision ||
    !Array.isArray(result.participantIds) ||
    result.participantIds.length !== 2
  )
    {return false;}
  if (
    result.participantIds.some((id, index) => id !== value.participants[index])
  )
    {return false;}
  switch (value.state) {
    case "committed":
      return result.code === "trade-completed";
    case "cancelled":
      return result.code === "trade-cancelled";
    case "declined":
      return result.code === "trade-declined";
    case "failed":
      return result.code === "trade-failed";
    default:
      return false;
  }
}
