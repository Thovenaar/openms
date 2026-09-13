import { socialView, participantView } from "../social/local-social-view.js";
import {
  SOCIAL_ACTIONS,
  SOCIAL_REQUEST_FIELDS,
} from "../../../shared/social-protocol.js";
import { nativeOutcome } from "./native-source.js";
import { NativeSocialPeers } from "./native-social-peers.js";
import { NativeSocialChat } from "./native-social-chat.js";

const MEDALS = [
  "medal.equip",
  "medal.challenge",
  "medal.forfeit",
  "medal.claim",
];
const MAX_LISTENERS = 64;
const PROJECTION_WAIT_MS = 20000;

function participantStore(entry) {
  return {
    id: entry.id,
    temporary: false,
    profile: {
      name: entry.name,
      level: entry.level,
      job: entry.job,
      hp: entry.hp,
      maxHP: entry.maxHp,
      ...entry.portrait,
      location: { mapId: entry.mapId },
      social: {
        search: entry.search,
        guild: entry.guild,
        family: entry.family,
      },
    },
  };
}

/** Existing native socialView/windows consume publications, never browser-owned social drafts. */
export class NativeSocial {
  constructor(owner) {
    this.owner = owner;
    this.store = owner.store;
    this.actions = [...SOCIAL_ACTIONS, ...MEDALS];
    this.participantErrors = [];
    this.listeners = new Set();
    this.stores = new Map();
    this.rows = new Map();
    this.view = null;
    this.projections = new Map();
    this.messengerId = null;
    this.messengerSeen = new Set();
    this.operation = null;
    this.closed = false;
    this.invitation = null;
    this.invitationDirty = false;
    this.dismissed = new Set();
    this.peers = new NativeSocialPeers(this);
    this.chat = new NativeSocialChat(this);
    this.hooks = { familyRates: false, prepareFamilyTravel: null };
  }
  get catalog() {
    return this.owner.catalog;
  }
  get busy() {
    return (
      this.closed ||
      !this.view ||
      this.owner.blocked() ||
      this.owner.pending > 0 ||
      Boolean(this.operation)
    );
  }
  get pending() {
    return Boolean(this.operation);
  }
  waitForIdle() {
    return Promise.allSettled([this.operation]);
  }
  getParticipant(id) {
    return id === this.store.id ? this.store : (this.stores.get(id) ?? null);
  }
  participants() {
    if (!this.view) return [];
    const result = [];
    for (const row of this.rows.values())
      {result.push({
        ...participantView(this.getParticipant(row.id), this.catalog),
        online: row.online,
        local: false,
      });}
    return result;
  }
  invitations() {
    return this.snapshot().requests;
  }
  medalEntries() {
    return this.owner.quests.medalEntries();
  }
  medalHook(action) {
    const quests = this.owner.quests;
    if (action === "medal.equip") return quests?.equipMedal.bind(quests);
    if (action === "medal.challenge")
      {return quests?.medalChallenge.bind(quests);}
    if (action === "medal.claim") return quests?.medalClaim.bind(quests);
    if (action === "medal.forfeit") return quests?.medalForfeit.bind(quests);
    return null;
  }
  snapshot() {
    if (!this.view || !this.store.profile)
      {throw new Error("The server social projection is not prepared.");}
    const snapshot = socialView(this);
    snapshot.local = false;
    const cohorts = [
      snapshot.participants,
      snapshot.friends,
      snapshot.blacklist,
    ];
    for (const kind of ["party", "guild", "alliance", "family", "messenger"])
      {if (snapshot[kind]) cohorts.push(snapshot[kind].members);}
    if (snapshot.alliance)
      {for (const guild of snapshot.alliance.guilds) cohorts.push(guild.members);}
    for (const cohort of cohorts)
      {for (const member of cohort) {
        member.local = false;
        member.online = this.rows.get(member.id)?.online === true;
      }}
    snapshot.self.local = false;
    return snapshot;
  }
  subscribe(listener) {
    if (
      this.closed ||
      typeof listener !== "function" ||
      this.listeners.size >= MAX_LISTENERS
    )
      {throw new Error("Invalid social observer.");}
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async prepare() {
    if (this.view) return this.snapshot();
    const result = await this.read();
    if (!result.ok) throw new Error(result.reason);
    return this.snapshot();
  }
  async read(query = "", targetId = null) {
    const receipt = await this.owner.command({
      kind: "social.read",
      query,
      ...(targetId ? { targetId } : {}),
    });
    const outcome = nativeOutcome(receipt);
    if (outcome.ok && receipt.value?.kind === "social.read")
      {await this.waitForProjection(receipt.value.projectionId);}
    else if (outcome.ok)
      {throw new Error("The social read receipt has no typed projection.");}
    return outcome;
  }
  waitForProjection(projectionId) {
    if (this.view?.projectionId === projectionId)
      {return Promise.resolve(this.view);}
    if (
      this.closed ||
      this.projections.size >= 32 ||
      this.projections.has(projectionId)
    )
      {return Promise.reject(
        new Error("The social publication request is unavailable."),
      );}
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.projections.delete(projectionId);
        reject(
          new Error(
            "The complete server social publication did not arrive. Reconnect to refresh it.",
          ),
        );
      }, PROJECTION_WAIT_MS);
      this.projections.set(projectionId, { resolve, reject, timer });
    });
  }
  async resolveTarget(name) {
    const receipt = await this.owner.command({
      kind: "social.resolve",
      name: name.trim(),
    });
    const outcome = nativeOutcome(receipt);
    if (!outcome.ok) return outcome;
    if (receipt.value?.kind !== "social.identity")
      {throw new Error("The identity authority returned no typed target.");}
    return { ok: true, targetId: receipt.value.targetId };
  }
  execute(action, payload = {}) {
    if (this.busy)
      {return Promise.resolve({
        ok: false,
        code: "CHARACTER_BUSY",
        reason: "The social authority is busy or disconnected.",
      });}
    if (payload.actorId !== undefined && payload.actorId !== this.store.id)
      {return Promise.resolve({
        ok: false,
        code: "NOT_ALLOWED",
        reason:
          "Online social operations can only act as the authenticated character.",
      });}
    if (MEDALS.includes(action)) {
      const hook = this.medalHook(action);
      if (!hook)
        {return Promise.resolve({
          ok: false,
          reason: "The medal authority is not prepared.",
        });}
      return action === "medal.equip"
        ? hook(payload.uid)
        : hook(payload.questId, payload.confirmed);
    }
    if (!Object.hasOwn(SOCIAL_REQUEST_FIELDS, action))
      {return Promise.resolve({ ok: false, reason: "Unknown social action." });}
    const request = { kind: action };
    for (const field of Object.keys(SOCIAL_REQUEST_FIELDS[action]))
      {if (payload[field] !== undefined) request[field] = payload[field];}
    this.operation = this.commit(request).finally(() => {
      this.operation = null;
      this.notify();
      this.observeInvitation();
    });
    return this.operation;
  }
  async commit(request) {
    const receipt = await this.owner.command({
      kind: "social.execute",
      request,
    });
    const outcome = nativeOutcome(receipt);
    if (!outcome.ok) return outcome;
    if (receipt.value?.kind !== "social.result")
      {throw new Error("The social authority returned no typed result.");}
    return { ...outcome, ...receipt.value };
  }
  publish(view) {
    if (this.closed || !view) return;
    this.view = view;
    this.stores.clear();
    this.rows.clear();
    for (const entry of view.participants) {
      this.rows.set(entry.id, entry);
      this.stores.set(entry.id, participantStore(entry));
    }
    this.hooks.familyRates = view.familyRates;
    this.hooks.prepareFamilyTravel = view.familyTravel;
    this.peers.publish(view.selectedPeer);
    const waiting = this.projections.get(view.projectionId);
    if (waiting) {
      clearTimeout(waiting.timer);
      this.projections.delete(view.projectionId);
      waiting.resolve(view);
    }
    this.observeMessenger();
    this.notify();
    if (!this.store.profile.social.party) this.owner.ui.close("PartyHP", true);
    this.observeInvitation();
  }
  notify() {
    if (this.closed) return;
    for (const listener of this.listeners) listener(this);
  }
  observeMessenger() {
    const session = this.store.profile.social.messenger;
    if (!session) {
      this.messengerId = null;
      this.messengerSeen.clear();
      return;
    }
    const initial = this.messengerId !== session.id;
    this.messengerId = session.id;
    const retained = new Set(session.messages.map((entry) => entry.id));
    for (const id of this.messengerSeen)
      {if (!retained.has(id)) this.messengerSeen.delete(id);}
    for (const message of session.messages) {
      if (
        !initial &&
        !this.messengerSeen.has(message.id) &&
        message.senderId !== this.store.id
      ) {
        this.owner.ui.chat.receive({
          source: "session",
          text: `[Messenger] ${message.senderName}: ${message.text}`,
          time: performance.now(),
        });
      }
      this.messengerSeen.add(message.id);
    }
  }
  pollInvitation() {
    if (
      !this.invitationDirty ||
      this.busy ||
      this.owner.ui.modal() ||
      this.owner.ui.closingAll
    )
      {return;}
    this.observeInvitation();
  }
  reconcileInvitations() {
    const requests = this.invitations().filter((entry) => entry.incoming);
    const current = new Set(requests.map((entry) => entry.id));
    for (const id of this.dismissed)
      {if (!current.has(id)) this.dismissed.delete(id);}
    if (this.invitation && !current.has(this.invitation.request.id))
      {this.closeInvitation();}
    this.invitationDirty = false;
    return requests;
  }
  observeInvitation() {
    if (!this.view || !this.store.profile) return;
    const requests = this.reconcileInvitations();
    if (this.invitation) return;
    if (
      this.busy ||
      this.owner.ui.socialInvitation ||
      this.owner.ui.modal() ||
      this.owner.ui.closingAll
    ) {
      this.invitationDirty = requests.some(
        (entry) => !this.dismissed.has(entry.id),
      );
      return;
    }
    const request = requests.find((entry) => !this.dismissed.has(entry.id));
    if (!request) return;
    this.invitation = {
      request,
      answer: (accepted) => this.answerInvitation(request, accepted),
    };
    this.owner.ui.socialInvitation = this.invitation;
    this.owner.ui.open("SocialInvitation").catch((error) => {
      this.closeInvitation();
      this.owner.report(error);
    });
  }
  answerInvitation(request, accepted) {
    if (this.invitation?.request.id !== request.id) return;
    this.dismissed.add(request.id);
    this.closeInvitation();
    if (accepted === null) return;
    this.execute(accepted ? "invitation.accept" : "invitation.decline", {
      invitationId: request.id,
    })
      .then((outcome) => {
        if (!outcome.ok) this.owner.report(outcome.reason);
        this.observeInvitation();
      })
      .catch((error) => this.owner.report(error));
  }
  closeInvitation() {
    const previous = this.invitation;
    this.invitation = null;
    if (this.owner.ui.socialInvitation === previous)
      {this.owner.ui.socialInvitation = null;}
    this.owner.ui.close("SocialInvitation", true);
  }
  selectedId() {
    return this.peers.selectedId();
  }
  selectedStore() {
    return this.peers.selectedStore();
  }
  nativeHooks() {
    return {
      social: () => this,
      ...this.peers.nativeHooks(),
      socialChat: (request) => this.chat.select(request),
      socialPartyHp: (enabled) => this.peers.togglePartyHP(enabled),
      socialOutcome: (result) => {
        if (result?.ok === false) this.owner.report(result.reason);
      },
    };
  }
  destroy() {
    this.closed = true;
    this.closeInvitation();
    this.peers.destroy();
    this.chat.destroy();
    this.listeners.clear();
    this.stores.clear();
    this.rows.clear();
    this.dismissed.clear();
    for (const waiting of this.projections.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(
        new Error(
          "The social publication was cancelled by character teardown.",
        ),
      );
    }
    this.projections.clear();
    this.messengerSeen.clear();
    this.view = null;
  }
}
