import {
  interactionReceipt,
  publishInteraction,
  requireInteraction,
} from "./interaction-common.js";

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

function groupRecipients(actor, channel, world) {
  const group = actor.profile.social[channel];
  const ids = memberIds(group);
  requireInteraction(ids.includes(actor.id), "NOT_ALLOWED");
  const signature = JSON.stringify(group);
  const recipients = [];
  for (const id of ids) {
    const peer = world.actors.get(id);
    if (!peer || peer === actor) continue;
    const membership = peer.profile.social[channel];
    requireInteraction(
      membership &&
        membership.id === group.id &&
        JSON.stringify(membership) === signature &&
        memberIds(membership).includes(actor.id),
      "NOT_ALLOWED",
    );
    if (channel === "alliance") {
      requireInteraction(
        group.guilds.includes(peer.profile.social.guild?.id) &&
          group.guilds.includes(actor.profile.social.guild?.id),
        "NOT_ALLOWED",
      );
    }
    if (permitted(actor, peer, channel)) recipients.push(peer);
  }
  return recipients;
}

function buddyRecipients(actor, world) {
  const friends = actor.profile.social.friends;
  requireInteraction(friends.length <= MAX_MEMBERS, "CONTENT_MISMATCH");
  const recipients = [];
  for (const friend of friends) {
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

function mapRecipients(actor, world) {
  requireInteraction(
    actor.field.characters.size <= MAX_RECIPIENTS,
    "SERVER_BUSY",
  );
  const visible = new Set(
    world
      .entities(actor)
      .filter((entity) => entity.kind === "player")
      .map((entity) => entity.id),
  );
  const recipients = [];
  for (const peer of actor.field.characters.values()) {
    if (
      peer !== actor &&
      visible.has(peer.id) &&
      permitted(actor, peer, "map")
    ) {
      recipients.push(peer);
    }
  }
  return recipients;
}

function chatRecipients(actor, action, world) {
  if (action.channel === "map") return mapRecipients(actor, world);
  if (action.channel === "buddy") return buddyRecipients(actor, world);
  if (["party", "guild", "alliance"].includes(action.channel)) {
    return groupRecipients(actor, action.channel, world);
  }
  // No authored spouse relation exists in the admitted durable social schema.
  requireInteraction(action.channel !== "spouse", "CONTENT_MISMATCH");
  requireInteraction(
    action.channel === "whisper" && action.recipientId !== actor.id,
    "NOT_ALLOWED",
  );
  const peer = world.actors.get(action.recipientId);
  // The same opaque denial covers offline, blocked and private recipients.
  requireInteraction(permitted(actor, peer, "whisper"), "NOT_ALLOWED");
  return [peer];
}

export function executeChat(actor, message, world) {
  chatAdmission(actor, message);
  const recipients = chatRecipients(actor, message.action, world);
  const event = {
    kind: "chat",
    messageId: crypto.randomUUID(),
    senderId: actor.id,
    senderName: actor.profile.name,
    channel: message.action.channel,
    text: message.action.text,
  };
  publishInteraction(world, actor, event);
  for (const peer of recipients) publishInteraction(world, peer, event);
  return interactionReceipt(actor.socialRevision);
}
