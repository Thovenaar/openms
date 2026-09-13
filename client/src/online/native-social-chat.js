import {
  parseNativeChat,
  NATIVE_CHAT_CHANNELS,
} from "../social/chat-routing.js";
import { sanitizeChat } from "../social/chat-rules.js";
import { nativeOutcome } from "./native-source.js";

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
      if (!resolved.ok) throw new Error(resolved.reason);
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
      const outcome = nativeOutcome(await this.owner.command(action));
      if (outcome.ok && channel === "whisper") {
        this.whisperId = action.recipientId;
      }
      return {
        accepted: outcome.ok,
        reason: outcome.reason,
        delivery: "server",
        text: parsed.text,
      };
    } catch (error) {
      return { accepted: false, reason: error.message };
    }
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
        if (!resolved.ok) throw new Error(resolved.reason);
        targetId = resolved.targetId;
      }
      action.recipientId = targetId;
    }
    return action;
  }
  receive(event) {
    const channelIndex = WIRE_CHANNELS.indexOf(event.channel);
    if (channelIndex < 0) return;
    if (this.seen.has(event.messageId)) return;
    if (this.seen.size >= 128) {
      this.seen.delete(this.seen.values().next().value);
    }
    this.seen.add(event.messageId);
    if (event.channel === "whisper" && event.senderId !== this.owner.store.id) {
      this.whisperId = event.senderId;
    }
    this.owner.ui.chat.receive({
      source: "session",
      text: `${channelIndex === 7 ? "" : `[${CHANNEL_NAMES[channelIndex]}] `}${event.senderName}: ${event.text}`,
      time: performance.now(),
      senderId: event.senderId,
      recipientId: this.owner.store.id,
      channelIndex,
      message: event.text,
      delivery: "server",
    });
  }
  destroy() {
    this.targetId = null;
    this.whisperId = null;
    this.seen.clear();
  }
}
