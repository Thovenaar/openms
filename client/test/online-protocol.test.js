import { test, expect } from "bun:test";
import {
  decodeClient,
  decodeJson,
  canonicalAction,
} from "../../shared/protocol.js";

const envelope = {
  v: 1,
  type: "command",
  connectionEpoch: "connection_opaque",
  seq: 1,
  fieldEpoch: "field_opaque",
  operationId: "86d95e28-cb1a-42e0-a244-098cf0d8f2aa",
  expectedRevision: 0,
};

test("a legal portal intent cannot smuggle its destination or acting character", () => {
  const command = {
    ...envelope,
    action: { kind: "portal.enter", portalId: 3 },
  };
  expect(decodeClient(JSON.stringify(command)).action.portalId).toBe(3);
  command.action.targetMap = 100000000;
  expect(() => decodeClient(JSON.stringify(command))).toThrow(
    "INVALID_MESSAGE",
  );
  delete command.action.targetMap;
  command.characterId = "another_owned_character";
  expect(() => decodeClient(JSON.stringify(command))).toThrow(
    "INVALID_MESSAGE",
  );
});

test("duplicate escaped keys and noncanonical numbers cannot change decoder meaning", () => {
  expect(() => decodeJson('{"quantity":1,"\\u0071uantity":200}')).toThrow(
    "INVALID_MESSAGE",
  );
  expect(() => decodeJson('{"quantity":-0}')).toThrow("INVALID_MESSAGE");
  expect(() => decodeJson('{"quantity":9007199254740993}')).toThrow(
    "INVALID_MESSAGE",
  );
  expect(() =>
    decodeJson(new Uint8Array([123, 34, 120, 34, 58, 34, 0xc0, 0x80, 34, 125])),
  ).toThrow("INVALID_MESSAGE");
});

test("canonical action identity ignores key order but preserves the owned item and quantity", () => {
  const first = {
    kind: "inventory.move",
    itemId: "opaque_item",
    quantity: 2,
    to: { tab: "use", slot: 3 },
  };
  const reordered = {
    to: { slot: 3, tab: "use" },
    quantity: 2,
    itemId: "opaque_item",
    kind: "inventory.move",
  };
  expect(canonicalAction(first)).toBe(canonicalAction(reordered));
  reordered.quantity = 3;
  expect(canonicalAction(first)).not.toBe(canonicalAction(reordered));
});
