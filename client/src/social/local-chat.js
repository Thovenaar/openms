import { PROFILE_LIMITS } from "../profile/profile-validation.js";
import { SOCIAL_LIMITS } from "../profile/profile-social.js";
import { memberIds, socialRequire } from "./local-social-context.js";

import { CHAT_LIMIT, sanitizeChat, admitChat } from "./chat-rules.js";
import { parseNativeChat } from "./chat-routing.js";
const MAILBOX_LIMIT = 128; // Browser session retention, not durable message storage.
const PAGE_LIMIT = 32;
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
const GROUP_KINDS = [null, null, "party", "guild", "alliance"];
const RECEIVE_OPTIONS = {
  3: "allowGuildChat",
  4: "allowAllianceChat",
  6: "allowWhisper",
};

function sessionState() {
  return {
    mailbox: [],
    whisperId: null,
    recent: [],
    recentStarted: -Infinity,
    submitTimes: new Float64Array(4).fill(-Infinity),
    submitIndex: 0,
    blockedUntil: -Infinity,
  };
}

function denied(reason) {
  return { accepted: false, reason };
}

/** Local prepared ProfileStore participants only; never a server connection or an All echo.
 * Numeric channels are the eight original HUD modes. The explicit "messenger" route is
 * an external producer API for the existing durable Messenger authority, not a ninth mode. */
export class LocalChat {
  constructor(store, social, hooks) {
    if (
      !store?.profile ||
      social?.getParticipant(store.id) !== store ||
      typeof hooks?.fieldSpeech !== "function" ||
      typeof hooks?.receive !== "function"
    ) {
      throw new TypeError(
        "LocalChat requires the current loaded participant and speech/receive hooks",
      );
    }
    this.store = store;
    this.social = social;
    this.hooks = hooks;
    this._sessions = new Map();
    this._messengerSeen = new Map();
    this._operation = null;
    this._closing = false;
    this._closed = false;
    this._destruction = null;
    this.delegatingSocial = false;
    this._observeMessenger(false);
    this._unsubscribe = social.subscribe(() => {
      try {
        this._observeMessenger(true);
      } catch (error) {
        this._report(error);
      }
    });
  }

  get pending() {
    return Boolean(this._operation);
  }

  waitForIdle() {
    return this._operation ?? Promise.resolve();
  }

  async submit(text, channelIndex) {
    return this._enqueue({
      actorId: this.store.id,
      text,
      channelIndex,
      targetId: this.hooks.getTargetId?.(),
      inputGate: false,
    });
  }

  async submitAs(actorId, text, channelIndex, targetId) {
    return this._enqueue({
      actorId,
      text,
      channelIndex,
      targetId,
      inputGate: true,
    });
  }

  async _enqueue(request) {
    const { channelIndex } = request;
    if (this._closing || this._closed) {
      return denied("The local chat session is closed.");
    }
    if (this.pending || this.hooks.isBusy?.()) {
      return denied(
        "Another local operation is pending; nothing was delivered.",
      );
    }
    const inputError = this._requestError(request);
    if (inputError) return denied(inputError);
    const text = sanitizeChat(request.text);
    if (!text) return denied("Enter a message.");
    const socialReady = !this.social.busy;
    if (channelIndex !== 7 && !socialReady) {
      return denied(
        "The local social participants are busy or not yet prepared.",
      );
    }
    this._operation = this._submit({ ...request, text, socialReady });
    return this._completeOperation();
  }

  async _completeOperation() {
    try {
      return await this._operation;
    } catch (error) {
      if (!error.code) this._report(error);
      return denied(error.message ?? "The local chat operation failed.");
    } finally {
      this._operation = null;
    }
  }

  _requestError({ text, targetId, channelIndex }) {
    if (typeof text !== "string" || text.length > CHAT_LIMIT) {
      return "Chat is limited to70 characters.";
    }
    if (
      targetId !== null &&
      targetId !== undefined &&
      (typeof targetId !== "string" || targetId.length > 64)
    ) {
      return "Choose a loaded character or an existing buddy group.";
    }
    if (
      !(
        Number.isInteger(channelIndex) &&
        channelIndex >= 0 &&
        channelIndex < CHANNEL_NAMES.length
      ) &&
      channelIndex !== "messenger"
    ) {
      return "Choose one of the eight original chat channels or the explicit local Messenger producer.";
    }
    return null;
  }

  _participant(id, committed = false) {
    const participant = this.social.getParticipant(id);
    socialRequire(
      participant?.profile &&
        !participant.error &&
        (committed || !participant.profileTransactionPending),
      "chat-participant",
      "The selected local character is unavailable or has a pending profile transaction.",
    );
    return participant;
  }

  _session(id) {
    if (!this._sessions.has(id)) {
      socialRequire(
        this._sessions.size < PROFILE_LIMITS.characters,
        "chat-capacity",
        "The local chat participant capacity was reached.",
      );
      this._sessions.set(id, sessionState());
    }
    return this._sessions.get(id);
  }

  _findName(name) {
    const participants = this.social.participants();
    socialRequire(
      participants.length <= PROFILE_LIMITS.characters,
      "chat-capacity",
      "The local participant roster exceeds its bound.",
    );
    const match = participants.find(
      (participant) => participant.name.toLowerCase() === name.toLowerCase(),
    );
    socialRequire(
      match,
      "chat-recipient",
      `No prepared local character named '${name}' is loaded.`,
    );
    return match.id;
  }

  _parse(request, state) {
    const parsed = parseNativeChat(request, state.whisperId);
    if (parsed.recipientName) {
      parsed.targetId = this._findName(parsed.recipientName);
      delete parsed.recipientName;
    }
    return parsed;
  }

  async _submit(request) {
    // Publish pending before callbacks can re-enter or durable Messenger begins its own transaction.
    await Promise.resolve();
    const actor = this._participant(request.actorId),
      state = this._session(actor.id);
    const parsed = this._parse(request, state);
    socialRequire(
      parsed.channelIndex === 7 || request.socialReady,
      "chat-preparation",
      "The local social participants are busy or not yet prepared.",
    );
    if (!parsed.text) return this._select(parsed, actor, state);
    const now = this.hooks.now?.() ?? performance.now();
    socialRequire(
      Number.isFinite(now) && now >= 0,
      "chat-clock",
      "The local chat clock is unavailable.",
    );
    if (request.inputGate && !admitChat(state, parsed.text, now)) {
      return denied(
        "Chat is too frequent; wait2.8 seconds before sending again.",
      );
    }
    if (parsed.channelIndex === 7) return this._speech(actor, parsed.text);
    const recipients = this._recipients(actor, parsed, state);
    if (parsed.channelIndex === "messenger") {
      return this._messenger(actor, parsed.text);
    }
    this._deliver(actor, recipients, parsed, now);
    if (parsed.channelIndex === 6) state.whisperId = recipients[0].id;
    return {
      accepted: true,
      delivery: "local-session",
      text: parsed.text,
      recipients: recipients.map((entry) => entry.id),
    };
  }

  _select(request, actor, state) {
    if (request.channelIndex === 6) {
      const target = this._recipients(actor, request, state)[0];
      state.whisperId = target.id;
      return {
        accepted: false,
        delivery: "channel-selected",
        channelIndex: 6,
        reason: `Whisper recipient selected: ${target.profile.name} (local).`,
      };
    }
    socialRequire(
      request.channelIndex !== 5,
      "chat-spouse",
      "The saved local social authority has no spouse or marriage relationship; spouse chat cannot be delivered.",
    );
    return {
      accepted: false,
      delivery: "channel-selected",
      channelIndex: request.channelIndex,
      reason: "Chat channel selected; no message was submitted.",
    };
  }

  _speech(actor, text) {
    // A loaded peer is not the resident avatar. Never display that peer's words over the current character.
    if (actor !== this.store) {
      return denied(
        "All speech requires that participant's resident field avatar and fieldSpeech authority; the selected peer is not resident.",
      );
    }
    if (this.hooks.fieldSpeech(text) !== true) {
      return denied(
        "Local field speech is unavailable; nothing was delivered.",
      );
    }
    return { accepted: true, delivery: "local-only", text };
  }

  _recipients(actor, request, state) {
    const channel = request.channelIndex,
      profile = actor.profile;
    socialRequire(
      channel !== 5,
      "chat-spouse",
      "The saved local social authority has no spouse or marriage relationship; spouse chat cannot be delivered.",
    );
    let ids;
    if (channel === 6) {
      const id = request.targetId ?? state.whisperId;
      socialRequire(
        id,
        "chat-recipient",
        "Select a loaded Whisper recipient in UserList, or enter /whisper CharacterName before your message.",
      );
      ids = [id];
    } else if (channel === 0 || channel === 1) {
      ids = this._buddyIds(profile.social, request);
    } else {
      ids = this._groupIds(
        actor,
        channel === "messenger" ? "messenger" : GROUP_KINDS[channel],
      );
    }
    socialRequire(
      ids.length > 0,
      "chat-no-recipients",
      "No other prepared local members are available for this chat.",
    );
    const recipients = ids.map((id) => this._participant(id));
    for (const recipient of recipients) {
      this._admitRecipient(actor, recipient, channel);
    }
    return recipients;
  }

  _buddyIds(social, request) {
    let group = null;
    if (request.channelIndex === 1) {
      group = request.targetId?.startsWith("group:")
        ? request.targetId.slice(6)
        : social.friends.find((friend) => friend.id === request.targetId)
            ?.group;
      socialRequire(
        group && social.groups.includes(group),
        "chat-group",
        "Select an existing buddy group with UserList's Group whisper control before sending to Group.",
      );
    }
    return social.friends
      .filter((friend) => group === null || friend.group === group)
      .map((friend) => friend.id);
  }

  _groupIds(actor, kind) {
    const group = actor.profile.social[kind];
    socialRequire(
      group && !group.forming && memberIds(group).includes(actor.id),
      "chat-membership",
      `An established local ${kind} membership is required.`,
    );
    const ids = memberIds(group);
    for (const id of ids) {
      const peerGroup = this._participant(id).profile.social[kind];
      socialRequire(
        peerGroup && JSON.stringify(peerGroup) === JSON.stringify(group),
        "chat-membership",
        `The saved ${kind} memberships disagree; nothing was delivered.`,
      );
      if (kind === "alliance") {
        socialRequire(
          group.guilds.includes(this._participant(id).profile.social.guild?.id),
          "chat-alliance",
          "An alliance recipient has no matching guild membership.",
        );
      }
    }
    return ids.filter((id) => id !== actor.id);
  }

  _admitRecipient(actor, recipient, channel) {
    socialRequire(
      actor !== recipient,
      "chat-self",
      "You cannot whisper to yourself.",
    );
    socialRequire(
      !actor.profile.social.blacklist.includes(recipient.id) &&
        !recipient.profile.social.blacklist.includes(actor.id),
      "chat-blocked",
      "A participant blacklist prevents this local chat; nothing was delivered.",
    );
    if (channel === 0 || channel === 1) {
      socialRequire(
        recipient.profile.social.friends.some((entry) => entry.id === actor.id),
        "chat-buddy",
        "The recipient does not have a reciprocal saved buddy relationship.",
      );
    }
    const flag = RECEIVE_OPTIONS[channel];
    socialRequire(
      !flag || recipient.profile.settings.gameOptions[flag],
      "chat-disabled",
      `${recipient.profile.name} has disabled this receiving channel in Game Options; nothing was delivered.`,
    );
    // allowMessenger/allowParty/allowFriend are invitation flags, not chat-receiving flags.
  }

  _deliver(actor, recipients, { channelIndex, text: message }, time) {
    const name =
      channelIndex === "messenger" ? "Messenger" : CHANNEL_NAMES[channelIndex];
    for (const recipient of recipients) {
      const state = this._session(recipient.id),
        mailbox = state.mailbox;
      const record = Object.freeze({
        source: "session",
        text: `[Local ${name}] ${actor.profile.name}: ${message}`,
        time,
        senderId: actor.id,
        recipientId: recipient.id,
        channelIndex,
        message,
        delivery: "local-session",
      });
      if (mailbox.length === MAILBOX_LIMIT) mailbox.shift();
      mailbox.push(record);
      if (channelIndex === 6) state.whisperId = actor.id;
      if (recipient === this.store) {
        try {
          this.hooks.receive(record);
        } catch (error) {
          this._report(error);
        }
      }
    }
  }

  async _messenger(actor, text) {
    this.delegatingSocial = true;
    try {
      const result = await this.social.execute("messenger.send", {
        actorId: actor.id,
        text,
      });
      if (!result?.ok) {
        return denied(
          result?.reason ??
            "The durable local Messenger authority did not accept the message.",
        );
      }
      this._observeMessenger(true);
      return { accepted: true, delivery: "local-session", text };
    } finally {
      this.delegatingSocial = false;
    }
  }

  _observeMessenger(deliver) {
    const participants = this.social.participants(),
      active = new Set();
    socialRequire(
      participants.length <= PROFILE_LIMITS.characters,
      "chat-capacity",
      "The local Messenger roster exceeds its bound.",
    );
    for (const participant of participants) {
      const session = this.social.getParticipant(participant.id)?.profile.social
        .messenger;
      if (!session || active.has(session.id)) continue;
      active.add(session.id);
      this._observeSession(session, deliver);
    }
    for (const id of this._messengerSeen.keys()) {
      if (!active.has(id)) this._messengerSeen.delete(id);
    }
  }

  _observeSession(session, deliver) {
    socialRequire(
      session.messages.length <= SOCIAL_LIMITS.messages,
      "chat-capacity",
      "The durable Messenger history exceeds its bound.",
    );
    const seen = this._messengerSeen.get(session.id);
    // Existing saved messages are a baseline, not new deliveries on startup or group entry.
    if (!deliver || !seen) {
      this._messengerSeen.set(
        session.id,
        new Set(session.messages.map((entry) => entry.id)),
      );
      return;
    }
    const retained = new Set(session.messages.map((entry) => entry.id));
    for (const id of seen) if (!retained.has(id)) seen.delete(id);
    for (const message of session.messages) {
      if (seen.has(message.id)) continue;
      // The durable producer has already admitted this message; don't reinterpret it as a new request.
      const actor = this._participant(message.senderId, true);
      const recipients = session.members
        .filter((id) => id !== actor.id)
        .map((id) => this._participant(id, true));
      this._deliver(
        actor,
        recipients,
        { channelIndex: "messenger", text: message.text },
        message.createdAt,
      );
      seen.add(message.id);
    }
  }

  /** Demand-only bounded session mailbox; inspecting it never produces another delivery. */
  mailbox(actorId = this.store.id, offset = 0, limit = 20) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > PAGE_LIMIT
    ) {
      throw new RangeError("Invalid local chat mailbox page");
    }
    this._participant(actorId);
    const mailbox = this._sessions.get(actorId)?.mailbox ?? [];
    return {
      total: mailbox.length,
      offset,
      records: structuredClone(mailbox.slice(offset, offset + limit)),
    };
  }

  _report(error) {
    if (!this.hooks.onError) {
      console.error("Local chat failed", error);
      return;
    }
    try {
      this.hooks.onError(error);
    } catch (failure) {
      console.error("Local chat error observer failed", failure);
    }
  }

  destroy() {
    if (this._destruction) return this._destruction;
    this._closing = true;
    this._destruction = this._destroy();
    return this._destruction;
  }

  async _destroy() {
    if (this._operation) {
      await this._operation.catch((error) => this._report(error));
    }
    this._unsubscribe();
    this._sessions.clear();
    this._messengerSeen.clear();
    this._closed = true;
  }
}
