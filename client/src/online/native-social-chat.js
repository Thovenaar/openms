import {
  parseNativeChat,
  NATIVE_CHAT_CHANNELS,
} from "../social/chat-routing.js";
import { sanitizeChat } from "../social/chat-rules.js";
import { nativeOutcome, NativeOperationRefusal } from "./native-source.js";

const WIRE_CHANNELS = [
  "buddy",
  "group",
  "party",
  "guild",
  "alliance",
  "spouse",
  "whisper",
  "map",
];
const CHANNEL_NAMES = [
  "Buddy",
  "Group",
  "Party",
  "Guild",
  "Alliance",
  "Spouse",
  "Whisper",
  "All",
];

/** Selection stays local; delivery and recipient admission always return from the server. */
export class NativeSocialChat {
  constructor(social) {
    this.social = social;
    this.owner = social.owner;
    this.targetId = null;
    this.whisperId = null;
    this.seen = new Set();
    this.pending = new Map();
    this.generation = 0;
  }
  select({ channel, targetId, groupId } = {}) {
    const index = groupId !== undefined ? 1 : NATIVE_CHAT_CHANNELS[channel];
    if (index === undefined) {
      return { ok: false, reason: "Unknown original chat channel." };
    }
    if (index === 5) {
      return {
        ok: false,
        reason: "Spouse chat requires a real marriage authority.",
      };
    }
    this.targetId =
      groupId !== undefined ? `group:${groupId}` : (targetId ?? null);
    if (index === 6 && targetId) this.whisperId = targetId;
    this.owner.ui.chat.selector.selectedIndex = index;
    this.owner.ui.chat.open();
    return { ok: true };
  }
  async parsed(text, index) {
    const parsed = parseNativeChat(
      {
        text: sanitizeChat(text),
        channelIndex: index,
        targetId: this.targetId,
      },
      this.whisperId,
    );
    if (parsed.recipientName) {
      const resolved = await this.social.resolveTarget(parsed.recipientName);
      if (!resolved.ok) throw new NativeOperationRefusal(resolved);
      parsed.targetId = resolved.targetId;
      delete parsed.recipientName;
    }
    return parsed;
  }
  async submit(text, index) {
    try {
      const parsed = await this.parsed(text, index);
      const channel = WIRE_CHANNELS[parsed.channelIndex];
      if (!channel || channel === "spouse") {
        return {
          accepted: false,
          reason:
            "Spouse chat has no marriage authority, or the channel is unknown.",
        };
      }
      if (!parsed.text) return this.selectParsed(parsed);
      const action = await this.action(parsed, channel);
      if (!action) return { accepted: false, reason: "No recipient selected." };
      return this.enqueue(action, parsed);
    } catch (error) {
      return { accepted: false, reason: error.message };
    }
  }
  enqueue(action, parsed) {
    if (this.pending.size >= 8 || this.owner.blocked()) {
      return { accepted: false, reason: "Chat is waiting for a connection." };
    }
    const response = this.owner.command(action);
    if (!response.operationId) {
      return response.then((receipt) => ({
        accepted: false,
        reason: nativeOutcome(receipt).reason,
      }));
    }
    const messageId = response.operationId;
    const scene = this.owner.hooks.scene();
    const generation = this.generation;
    const event = {
      kind: "chat",
      messageId,
      senderId: this.owner.store.id,
      senderName: this.owner.store.profile.name,
      channel: action.channel,
      text: parsed.text,
    };
    this.pending.set(messageId, event);
    this.append(event, "pending");
    if (action.channel === "map") {
      scene?.events.chat(event).catch((error) => this.owner.report(error));
    }
    response
      .then((receipt) => {
        if (generation !== this.generation) return;
        const outcome = nativeOutcome(receipt);
        this.settle(messageId, outcome, scene);
        if (outcome.ok && action.channel === "whisper") {
          this.whisperId = action.recipientId;
        }
      })
      .catch((error) => {
        if (generation === this.generation) {
          this.settle(messageId, { ok: false, reason: error.message }, scene);
        }
      });
    return { accepted: true, delivery: "pending", text: parsed.text };
  }
  settle(messageId, outcome, scene) {
    this.pending.delete(messageId);
    this.owner.ui.chat.messages.settle(
      messageId,
      outcome.ok ? "server" : "failed",
      outcome.reason,
    );
    if (!outcome.ok) scene?.events.rejectChat(this.owner.store.id, messageId);
  }
  selectParsed(parsed) {
    if (parsed.channelIndex === 6) {
      if (!parsed.targetId || parsed.targetId === this.owner.store.id) {
        return {
          accepted: false,
          reason: "Choose another exact Whisper recipient.",
        };
      }
      this.whisperId = parsed.targetId;
    }
    return {
      accepted: false,
      delivery: "channel-selected",
      channelIndex: parsed.channelIndex,
      reason: "Chat channel selected; no message was submitted.",
    };
  }
  async action(parsed, channel) {
    const action = { kind: "chat.send", channel, text: parsed.text };
    if (channel === "group") {
      const target = parsed.targetId;
      const groupId = target?.startsWith("group:")
        ? target.slice(6)
        : this.owner.store.profile.social.friends.find(
            (entry) => entry.id === target,
          )?.group;
      if (
        !groupId ||
        !this.owner.store.profile.social.groups.includes(groupId)
      ) {
        throw new Error(
          "Select an existing buddy group with Group whisper first.",
        );
      }
      action.groupId = groupId;
    }
    if (channel === "whisper") {
      let targetId = parsed.targetId ?? this.whisperId;
      if (!targetId) {
        const name = await this.owner.ui.prompt({
          kind: "text",
          text: "Whisper to which character?",
          maxLength: 32,
        });
        if (name === null) return null;
        const resolved = await this.social.resolveTarget(name);
        if (!resolved.ok) throw new NativeOperationRefusal(resolved);
        targetId = resolved.targetId;
      }
      action.recipientId = targetId;
    }
    return action;
  }
  receive(event) {
    const channelIndex = WIRE_CHANNELS.indexOf(event.channel);
    if (channelIndex < 0) return;
    const key = `${event.senderId}:${event.messageId}`;
    if (this.seen.has(key)) return;
    if (this.seen.size >= 128) {
      this.seen.delete(this.seen.values().next().value);
    }
    this.seen.add(key);
    if (
      event.senderId === this.owner.store.id &&
      this.pending.has(event.messageId)
    ) {
      this.owner.ui.chat.messages.settle(event.messageId, "server");
      return;
    }
    if (
      event.senderId === this.owner.store.id &&
      this.owner.ui.chat.messages.records.some(
        (row) => row.messageId === event.messageId,
      )
    ) {
      this.owner.ui.chat.messages.settle(event.messageId, "server");
      return;
    }
    if (event.channel === "whisper" && event.senderId !== this.owner.store.id) {
      this.whisperId = event.senderId;
    }
    this.append(event, "server");
  }
  append(event, delivery) {
    const channelIndex = WIRE_CHANNELS.indexOf(event.channel);
    this.owner.ui.chat.receive({
      source: "session",
      text: `${channelIndex === 7 ? "" : `[${CHANNEL_NAMES[channelIndex]}] `}${event.senderName}: ${event.text}`,
      time: performance.now(),
      senderId: event.senderId,
      recipientId: this.owner.store.id,
      channelIndex,
      message: event.text,
      messageId: event.messageId,
      delivery,
    });
  }
  destroy() {
    this.targetId = null;
    this.whisperId = null;
    this.seen.clear();
    this.pending.clear();
    this.generation++;
  }
}
