import { expect, test } from "bun:test";
import { NativeSocialChat } from "../src/online/native-social-chat.js";
import { chatColor, ChatLog } from "../src/ui/chat-log.js";

test("server echoes retain own and peer map history exactly once, including channel colors", () => {
  const records = [];
  const chat = new NativeSocialChat({
    owner: {
      store: { id: "self" },
      ui: {
        chat: { messages: { records }, receive: (row) => records.push(row) },
      },
    },
  });
  for (const [messageId, senderId, channel] of [
    ["one", "self", "map"],
    ["two", "peer", "map"],
    ["three", "peer", "buddy"],
    ["four", "peer", "guild"],
    ["five", "peer", "whisper"],
    ["six", "self", "whisper"],
  ]) {
    const event = {
      messageId,
      senderId,
      senderName: senderId,
      channel,
      text: "hello",
    };
    chat.receive(event);
    chat.receive(event);
  }
  expect(records).toHaveLength(6);
  expect(records[0].text).toBe("self: hello");
  expect(records[1].text).toBe("peer: hello");
  expect(records.map(chatColor)).toEqual([
    "#ffffff",
    "#ffffff",
    "#ff9900",
    "#e1acfe",
    "#00ff00",
    "#00ff00",
  ]);
  expect(chat.whisperId).toBe("peer");
});

test("chat history copies channel metadata and keeps party, alliance and spouse palettes distinct", () => {
  const log = Object.create(ChatLog.prototype);
  log.records = [];
  log.row = (record) => ({ record });
  log.element = {
    scrollTop: 0,
    clientHeight: 40,
    scrollHeight: 40,
    append() {},
  };
  for (const channelIndex of [2, 4, 5]) {
    log.append({ source: "session", channelIndex, time: 1, text: "received" });
  }
  expect(log.page().records.map(chatColor)).toEqual([
    "#ff99cc",
    "#a6ff7f",
    "#ff28a7",
  ]);
  expect(log.page().records.map((row) => row.channelIndex)).toEqual([2, 4, 5]);
});
