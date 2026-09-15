import {
  interactionReceipt,
  publishInteraction,
  requireInteraction,
} from "./interaction-common.js";
import { admitActor } from "./action-rules.js";
import { socialEqual } from "../../client/src/profile/social-equality.js";

const MAX_RECIPIENTS = 2048;
const MAX_MEMBERS = 32;
const CHAT_WINDOW_MS = 2000;
const CHAT_WINDOW_MESSAGES = 4;
const RECEIVE_OPTIONS = Object.freeze({
  whisper: "allowWhisper",
  guild: "allowGuildChat",
  alliance: "allowAllianceChat",
});

/** Scan the protocol-bounded text for the chat policy's C0 and DEL controls. */
function containsChatControl(text) {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit <= 0x1f || unit === 0x7f) return true;
  }
  return false;
}

function chatAdmission(actor, message) {
  requireInteraction(
    message.expectedRevision === actor.socialRevision,
    "STALE_REVISION",
  );
  const now = Date.now();
  requireInteraction(
    (actor.profile.onlineState?.mutedUntil ?? 0) <= now,
    "NOT_ALLOWED",
  );
  requireInteraction(
    message.action.text.trim().length > 0 &&
      !containsChatControl(message.action.text),
    "INVALID_MESSAGE",
  );
  if (!actor.chatRate) actor.chatRate = { startedAt: now, count: 0 };
  if (now - actor.chatRate.startedAt >= CHAT_WINDOW_MS) {
    actor.chatRate.startedAt = now;
    actor.chatRate.count = 0;
  }
  requireInteraction(
    actor.chatRate.count < CHAT_WINDOW_MESSAGES,
    "RATE_LIMITED",
  );
  actor.chatRate.count++;
}

function permitted(actor, peer, channel) {
  if (
    !peer ||
    peer.state !== "active" ||
    !peer.session ||
    peer.session.revoked ||
    peer.session.expiresAt <= Date.now()
  ) {
    return false;
  }
  if (
    actor.profile.social.blacklist.includes(peer.id) ||
    peer.profile.social.blacklist.includes(actor.id)
  ) {
    return false;
  }
  const option = RECEIVE_OPTIONS[channel];
  return !option || peer.profile.settings.gameOptions[option] === true;
}

function memberIds(group) {
  requireInteraction(
    group &&
      !group.forming &&
      Array.isArray(group.members) &&
      group.members.length <= MAX_MEMBERS,
    "NOT_ALLOWED",
  );
  return group.members.map((member) =>
    typeof member === "string" ? member : member.id,
  );
}

async function groupRecipients(actor, channel, world) {
  const group = actor.profile.social[channel];
  const ids = memberIds(group);
  requireInteraction(ids.includes(actor.id), "NOT_ALLOWED");
  const profiles = await world.participants.load(ids);
  const recipients = [];
  for (const id of ids) {
    const profile = profiles.get(id);
    const membership = profile?.social[channel];
    requireInteraction(
      membership &&
        socialEqual(membership, group) &&
        memberIds(membership).includes(actor.id),
      "NOT_ALLOWED",
    );
    if (channel === "alliance") {
      requireInteraction(
        group.guilds.includes(profile.social.guild?.id) &&
          group.guilds.includes(actor.profile.social.guild?.id),
        "NOT_ALLOWED",
      );
    }
    const peer = world.actors.get(id);
    if (peer !== actor && permitted(actor, peer, channel)) {
      recipients.push(peer);
    }
  }
  return recipients;
}

function buddyRecipients(actor, world, groupId = null) {
  const friends = actor.profile.social.friends;
  requireInteraction(friends.length <= MAX_MEMBERS, "CONTENT_MISMATCH");
  const recipients = [];
  if (groupId !== null) {
    requireInteraction(
      actor.profile.social.groups.includes(groupId),
      "NOT_ALLOWED",
    );
  }
  for (const friend of friends) {
    if (groupId !== null && friend.group !== groupId) continue;
    const peer = world.actors.get(friend.id);
    if (
      permitted(actor, peer, "buddy") &&
      peer.profile.social.friends.some((entry) => entry.id === actor.id)
    ) {
      recipients.push(peer);
    }
  }
  return recipients;
}

function mapRecipients(actor) {
  requireInteraction(
    actor.field.characters.size <= MAX_RECIPIENTS,
    "SERVER_BUSY",
  );
  const recipients = [];
  for (const peer of actor.field.characters.values()) {
    if (
      peer !== actor &&
      peer.field === actor.field &&
      permitted(actor, peer, "map")
    ) {
      recipients.push(peer);
    }
  }
  return recipients;
}

async function chatRecipients(actor, action, world) {
  if (action.channel === "map") return mapRecipients(actor);
  if (action.channel === "buddy") return buddyRecipients(actor, world);
  if (action.channel === "group") {
    requireInteraction(typeof action.groupId === "string", "NOT_ALLOWED");
    return buddyRecipients(actor, world, action.groupId);
  }
  if (["party", "guild", "alliance"].includes(action.channel)) {
    return groupRecipients(actor, action.channel, world);
  }
  // No authored spouse relation exists in the admitted durable social schema.
  requireInteraction(action.channel !== "spouse", "CONTENT_MISMATCH");
  if (action.recipientName) {
    try {
      action = {
        ...action,
        recipientId: await world.participants.resolve(action.recipientName),
      };
    } catch {
      requireInteraction(false, "NOT_ALLOWED");
    }
  }
  requireInteraction(
    action.channel === "whisper" && action.recipientId !== actor.id,
    "NOT_ALLOWED",
  );
  const peer = world.actors.get(action.recipientId);
  // The same opaque denial covers offline, blocked and private recipients.
  requireInteraction(permitted(actor, peer, "whisper"), "NOT_ALLOWED");
  return [peer];
}

export async function executeChat(actor, message, world) {
  chatAdmission(actor, message);
  const recipients = await chatRecipients(actor, message.action, world);
  admitActor(actor, world, message.fieldEpoch);
  requireInteraction(
    message.expectedRevision === actor.socialRevision,
    "STALE_REVISION",
  );
  requireInteraction(
    message.action.channel === "map" || recipients.length > 0,
    "NOT_ALLOWED",
  );
  const event = {
    kind: "chat",
    messageId: message.operationId,
    senderId: actor.id,
    senderName: actor.profile.name,
    channel: message.action.channel,
    text: message.action.text,
  };
  publishInteraction(world, actor, event);
  for (const peer of recipients) publishInteraction(world, peer, event);
  return interactionReceipt(actor.socialRevision);
}
