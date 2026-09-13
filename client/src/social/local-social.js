import { socialEqual } from "../profile/social-equality.js";
import { ProfileStore } from "../profile/profile-store.js";
import { CharacterDevelopment } from "../character/character-development.js";
import { grantItem, consumeItem } from "../items/inventory-model.js";
import {
  createProfile,
  PROFILE_LIMITS,
  validateCharacterUids,
  validateProfileLocation,
} from "../profile/profile-validation.js";
import {
  SocialContext,
  memberIds,
  socialRequire,
} from "./local-social-context.js";
import { CONTACT_ACTIONS } from "./local-social-actions.js";
import { GROUP_ACTIONS } from "./local-social-groups.js";
import {
  FAMILY_ACTIONS,
  applyFamilyProgress,
  familyRate,
} from "./local-social-family.js";
import { BOARD_ACTIONS } from "./local-social-board.js";
import { INVITATION_ACTIONS } from "./local-social-invitations.js";
import {
  participantView,
  requestsView,
  socialView,
} from "./local-social-view.js";
import {
  domainArray,
  domainInteger,
} from "../profile/profile-domain-validation.js";
import {
  validateEmblem,
  validateRankTitles,
} from "../profile/profile-social.js";
import { hasSocialLinks } from "../profile/profile-social-transaction.js";
import { resetSocialParticipant } from "./local-social-reset.js";

const ACTIONS = Object.freeze({
  ...CONTACT_ACTIONS,
  ...GROUP_ACTIONS,
  ...FAMILY_ACTIONS,
  ...BOARD_ACTIONS,
  ...INVITATION_ACTIONS,
});
const MEDAL_ACTIONS = Object.freeze([
  "medal.equip",
  "medal.challenge",
  "medal.forfeit",
  "medal.claim",
]);
const PAYLOAD_FIELDS = Object.freeze([
  "actorId",
  "targetId",
  "invitationId",
  "groupId",
  "name",
  "text",
  "rank",
  "ranks",
  "emblem",
  "entitlement",
  "remove",
  "minLevel",
  "maxLevel",
  "jobs",
  "threadId",
  "commentId",
  "notice",
  "uid",
  "questId",
  "paused",
  "confirmed",
]);
const MAX_LISTENERS = 64;

function validPayload(payload) {
  socialRequire(
    payload && Object.getPrototypeOf(payload) === Object.prototype,
    "invalid-payload",
    "A plain action payload is required.",
  );
  const keys = Reflect.ownKeys(payload);
  socialRequire(
    keys.length <= PAYLOAD_FIELDS.length,
    "invalid-payload",
    "The action payload has too many fields.",
  );
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(payload, key);
    socialRequire(
      PAYLOAD_FIELDS.includes(key) &&
        descriptor.enumerable &&
        Object.hasOwn(descriptor, "value"),
      "invalid-payload",
      "The action payload contains an unknown field or accessor.",
    );
  }
  for (const field of [
    "actorId",
    "targetId",
    "invitationId",
    "threadId",
    "commentId",
    "uid",
  ]) {
    socialRequire(
      payload[field] === undefined ||
        (typeof payload[field] === "string" &&
          /^[A-Za-z0-9_-]{1,80}$/.test(payload[field])),
      "invalid-identity",
      "The action contains an invalid local identity.",
    );
  }
  validatePayloadValues(payload);
}

function validatePayloadValues(payload) {
  if (payload.emblem !== undefined) validateEmblem(payload.emblem);
  if (payload.ranks !== undefined) validateRankTitles(payload.ranks);
  if (payload.jobs !== undefined) {
    domainArray(payload.jobs, 64, "search jobs");
    for (const job of payload.jobs) domainInteger(job, 0, 9999, "search job");
  }
  for (const [key, value] of Object.entries(payload)) {
    if (["emblem", "ranks", "jobs"].includes(key)) continue;
    socialRequire(
      value === undefined ||
        typeof value === "boolean" ||
        (typeof value === "string" && value.length <= 600) ||
        (typeof value === "number" && Number.isSafeInteger(value)),
      "invalid-payload",
      "Action values must be bounded plain data.",
    );
  }
}

function validateRoster(stores) {
  validateCharacterUids([...stores.values()].map((store) => store.profile));
  for (const [id, store] of stores) {
    const social = store.profile.social;
    for (const reference of [
      ...social.friends.map((entry) => entry.id),
      ...social.blacklist,
    ]) {
      socialRequire(
        reference !== id && stores.has(reference),
        "social-participant",
        "A saved buddy or blacklist entry references an unavailable local character.",
      );
    }
    for (const kind of ["party", "guild", "alliance", "family", "messenger"]) {
      const group = social[kind];
      if (!group) continue;
      socialRequire(
        memberIds(group).includes(id),
        "social-owner",
        `Saved ${kind} does not contain its owning local character.`,
      );
      for (const memberId of memberIds(group)) {
        const peer = stores.get(memberId);
        socialRequire(
          peer && socialEqual(peer.profile.social[kind], group),
          "social-conflict",
          `The saved ${kind} has missing or disagreeing local participants.`,
        );
      }
    }
    for (const request of social.invitations) {
      socialRequire(
        request.fromId === id || request.toId === id,
        "invitation-owner",
        "A saved invitation is attached to the wrong character.",
      );
      const peerId = request.fromId === id ? request.toId : request.fromId;
      socialRequire(
        stores
          .get(peerId)
          ?.profile.social.invitations.some((entry) =>
            socialEqual(entry, request),
          ),
        "social-conflict",
        "A saved invitation has a missing or disagreeing local participant.",
      );
    }
  }
}

/** Browser-local authority over actual loaded ProfileStore handles; never a network roster. */
export class LocalSocial {
  constructor(store, catalog, hooks = {}) {
    this.store = store;
    this.catalog = catalog;
    this.hooks = hooks;
    this.actions = Object.freeze([...Object.keys(ACTIONS), ...MEDAL_ACTIONS]);
    this.participantErrors = [];
    this._stores = new Map([[store.id, store]]);
    this._preparing = false;
    this._unsubscribers = new Map();
    this._listeners = new Set();
    this._preparation = null;
    this._operation = null;
    this._ready = false;
    this._closed = false;
    this._queued = false;
    this._onChange = this._changed.bind(this);
    this._onNotify = this._notify.bind(this);
    this._unsubscribers.set(store.id, store.subscribe(this._onChange));
  }

  get busy() {
    return (
      this._closed ||
      !this._ready ||
      Boolean(
        this._operation ||
        this.store.profileTransactionPending ||
        this.hooks.isBusy?.(),
      )
    );
  }

  /** Registry-facing state deliberately excludes hooks.isBusy and ProfileStore locks. */
  get pending() {
    return this._preparing || Boolean(this._operation);
  }

  waitForIdle() {
    return Promise.allSettled([this._preparation, this._operation]);
  }

  prepare() {
    if (!this._preparation) {
      this._preparing = true;
      this._preparation = this._prepare().finally(() => {
        this._preparing = false;
        this._changed();
      });
    }
    return this._preparation;
  }

  async _prepare() {
    socialRequire(
      !this._closed,
      "social-closed",
      "The local social authority is closed.",
    );
    if (this.store.temporary) await this._prepareTemporaryPeers();
    else await this._prepareDurablePeers();
    validateRoster(this._stores);
    this._ready = true;
    this._changed();
    return this.snapshot();
  }

  async _prepareDurablePeers() {
    // Durable discovery remains unchanged; temporary peers are supplied only by local replay.
    const entries = await ProfileStore.listCharacters({
      items: this.catalog.ui?.items,
    });
    for (const entry of entries) {
      if (entry.id === this.store.id) continue;
      if (entry.error) {
        this.participantErrors.push({ id: entry.id, ...entry.error });
        continue;
      }
      const store = await ProfileStore.open({
        id: entry.id,
        items: this.catalog.ui?.items,
      });
      if (!store.profile || store.error) {
        this.participantErrors.push({
          id: entry.id,
          code: store.error?.code,
          message: store.error?.message,
        });
        await store.destroy().catch((error) => this._report(error));
      } else this._attach(store);
    }
  }

  async _prepareTemporaryPeers() {
    const peers = this.hooks.temporaryPeers?.() ?? [];
    socialRequire(
      Array.isArray(peers) && peers.length < PROFILE_LIMITS.characters,
      "character-limit",
      "Temporary replay roster exceeds its limit.",
    );
    for (const peer of peers) {
      const store = ProfileStore.memory(peer.profile, {
        id: peer.id,
        accountStorage: peer.accountStorage ?? undefined,
        items: this.catalog.ui?.items,
      });
      try {
        this._attach(store);
      } catch (error) {
        await store.destroy();
        throw error;
      }
    }
  }

  _attach(store) {
    socialRequire(
      this._stores.size < PROFILE_LIMITS.characters &&
        !this._stores.has(store.id),
      "character-limit",
      "The local roster is full or this character is already loaded.",
    );
    this._stores.set(store.id, store);
    this._unsubscribers.set(store.id, store.subscribe(this._onChange));
  }

  getParticipant(id) {
    return this._closed ? null : (this._stores.get(id) ?? null);
  }

  resolveTarget(name) {
    if (!this._closed && this._stores.has(name)) {
      return { ok: true, targetId: name };
    }
    const normalized =
      typeof name === "string" ? name.trim().toLowerCase() : "";
    const matches = [];
    for (const [id, store] of this._stores) {
      if (id === name || store.profile.name.toLowerCase() === normalized) {
        matches.push(id);
      }
    }
    if (this._closed || matches.length !== 1) {
      return {
        ok: false,
        code: matches.length > 1 ? "ambiguous-name" : "character-not-loaded",
        reason:
          matches.length > 1
            ? "More than one character has that name. Select an exact character identity."
            : "No loaded character has that exact name.",
      };
    }
    return { ok: true, targetId: matches[0] };
  }

  participants() {
    return Object.freeze(
      [...this._stores.values()].map((store) =>
        Object.freeze(participantView(store, this.catalog)),
      ),
    );
  }

  invitations() {
    const unique = new Map();
    for (const store of this._stores.values()) {
      for (const request of store.profile.social.invitations) {
        unique.set(request.id, request);
      }
    }
    return Object.freeze(
      requestsView(this, [...unique.values()]).map((entry) =>
        Object.freeze(entry),
      ),
    );
  }

  snapshot() {
    return socialView(this);
  }

  subscribe(listener) {
    socialRequire(
      typeof listener === "function" && !this._closed,
      "social-listener",
      "A live local social listener is required.",
    );
    socialRequire(
      this._listeners.size < MAX_LISTENERS,
      "listener-limit",
      "The local social observer limit was reached.",
    );
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _changed() {
    if (this._closed || this._queued) return;
    this._queued = true;
    queueMicrotask(this._onNotify);
  }

  _notify() {
    this._queued = false;
    if (this._closed) return;
    for (const listener of this._listeners) {
      try {
        listener(this);
      } catch (error) {
        this._report(error);
      }
    }
    try {
      this.hooks.onChange?.(this);
    } catch (error) {
      this._report(error);
    }
  }

  _report(error) {
    if (this.hooks.onError) {
      try {
        this.hooks.onError(error);
      } catch (failure) {
        console.error("Local social error observer failed", failure);
      }
    } else console.error("Local social authority failed", error);
  }

  async createParticipant(name) {
    if (this.busy) {
      return {
        ok: false,
        code: "social-busy",
        reason: "The local social authority is busy or not yet prepared.",
      };
    }
    try {
      socialRequire(
        typeof name === "string" && /^[A-Za-z0-9]{4,13}$/.test(name),
        "character-name",
        "Local character names use4–13 letters or numbers.",
      );
      socialRequire(
        ![...this._stores.values()].some(
          (entry) => entry.profile.name.toLowerCase() === name.toLowerCase(),
        ),
        "name-used",
        "That local character name is already in use.",
      );
      socialRequire(
        this._stores.size < PROFILE_LIMITS.characters,
        "character-limit",
        "The local character roster is full.",
      );
      this._operation = this._createParticipant(name);
      return await this._operation;
    } catch (error) {
      return this._failure(error);
    } finally {
      this._operation = null;
      this._changed();
    }
  }

  async _createParticipant(name) {
    let participant;
    if (this.store.temporary) {
      const profile = createProfile(this.store.profile.location);
      profile.name = name;
      participant = ProfileStore.memory(profile, {
        id: crypto.randomUUID(),
        items: this.catalog.ui?.items,
      });
    } else {
      participant = await ProfileStore.createCharacter({
        name,
        location: this.store.profile.location,
        items: this.catalog.ui?.items,
      });
    }
    if (participant.error || !participant.profile) {
      const error = participant.error;
      await participant.destroy().catch((failure) => this._report(failure));
      throw error;
    }
    this._attach(participant);
    return { ok: true, id: participant.id };
  }

  /** Explicit peer setup uses the same durable character and inventory authorities. */
  editParticipant(id, change) {
    if (this.busy) {
      return Promise.resolve({
        ok: false,
        reason: "Local characters are busy.",
      });
    }
    this._operation = this._editParticipant(id, change);
    return this._operation;
  }

  async _editParticipant(id, change) {
    await Promise.resolve();
    try {
      const store = this.getParticipant(id);
      socialRequire(
        store && store !== this.store,
        "peer-required",
        "Select another local character; use Character controls for yourself.",
      );
      socialRequire(
        change && typeof change === "object",
        "peer-edit",
        "Select a peer edit.",
      );
      if (change.kind === "level") {
        const development = new CharacterDevelopment(store, this.catalog);
        await development.edit({ level: change.level, exp: 0 });
      } else if (change.kind === "grant") {
        const template = this.catalog.ui.items[change.itemId];
        socialRequire(
          template && Number.isSafeInteger(change.itemId),
          "item-unavailable",
          "Select a packaged item.",
        );
        await store.commitProfile((draft) =>
          grantItem(draft, template, change.quantity),
        );
      } else if (change.kind === "remove") {
        await store.commitProfile((draft) =>
          consumeItem(draft, change.uid, change.quantity),
        );
      } else {
        socialRequire(false, "peer-edit", "Unknown peer edit.");
      }
      return { ok: true };
    } catch (error) {
      return this._failure(error);
    } finally {
      this._operation = null;
      this._changed();
    }
  }

  execute(action, payload = {}) {
    if (this.busy) {
      return Promise.resolve({
        ok: false,
        code: "social-busy",
        reason: "The local social authority is busy or not yet prepared.",
      });
    }
    this._operation = this._execute(action, payload);
    return this._operation;
  }

  async _execute(action, payload) {
    // Install the exclusion before any callback or asynchronous preparation can re-enter.
    await Promise.resolve();
    let prepared = null;
    let committed = false;
    try {
      validPayload(payload);
      socialRequire(
        Object.hasOwn(ACTIONS, action) || MEDAL_ACTIONS.includes(action),
        "social-action",
        "Unknown local social operation.",
      );
      const actorId = payload.actorId ?? this.store.id;
      socialRequire(
        this._stores.has(actorId),
        "participant-missing",
        "The acting local character is not loaded.",
      );
      if (MEDAL_ACTIONS.includes(action)) {
        return await this._medal(action, payload, actorId);
      }
      prepared = await this._prepareTravel(action, payload, actorId);
      const request = {
        ...structuredClone(payload),
        actorId,
        requestId: crypto.randomUUID(),
      };
      const result = await this._commit(ACTIONS[action], request, prepared);
      committed = true;
      if (prepared) prepared.publish();
      return { ok: true, ...result };
    } catch (error) {
      if (prepared && !committed) this._releasePrepared(prepared);
      if (committed) {
        this._report(error);
        return { ...this._failure(error), committed: true };
      }
      return this._failure(error);
    } finally {
      this._operation = null;
      this._changed();
    }
  }

  _travelRequest(action, payload, actorId) {
    let targetId = null,
      kind = null;
    if (action === "family.entitlement" && payload.entitlement === 0) {
      targetId = payload.targetId;
      kind = "reunion";
    }
    if (action === "family.entitlement" && payload.entitlement === 1) {
      targetId = payload.targetId;
      kind = "summon-invite";
    }
    if (action === "invitation.accept") {
      const request = this._stores
        .get(actorId)
        .profile.social.invitations.find(
          (entry) => entry.id === payload.invitationId,
        );
      if (request?.kind === "family-summon" && request.toId === actorId) {
        targetId = request.fromId;
        kind = "summon";
      }
    }
    if (!kind) return null;
    return { actorId, targetId, kind };
  }

  async _prepareTravel(action, payload, actorId) {
    const request = this._travelRequest(action, payload, actorId);
    if (!request) return null;
    const { targetId, kind } = request;
    socialRequire(
      this.hooks.prepareFamilyTravel,
      "family-travel-unavailable",
      "Original field-limit and portal-zero scene preparation is not attached.",
    );
    const prepared = await this.hooks.prepareFamilyTravel({
      actorId,
      targetId,
      kind,
    });
    try {
      socialRequire(
        prepared &&
          typeof prepared.publish === "function" &&
          typeof prepared.release === "function" &&
          typeof prepared.isCurrent === "function",
        "family-travel-preparation",
        "Family travel did not return an owned prepared scene.",
      );
      validateProfileLocation(prepared.location);
      return {
        actorId,
        targetId,
        location: structuredClone(prepared.location),
        publish: prepared.publish.bind(prepared),
        release: prepared.release.bind(prepared),
        isCurrent: prepared.isCurrent.bind(prepared),
      };
    } catch (error) {
      if (typeof prepared?.release === "function") {
        this._releasePrepared(prepared);
      }
      throw error;
    }
  }

  _releasePrepared(prepared) {
    try {
      prepared.release();
    } catch (error) {
      this._report(error);
    }
  }

  _context(profiles, request, prepared, now) {
    const context = new SocialContext(profiles, request.actorId, request, now);
    context.capabilities = {
      familyRates: this.hooks.familyRates === true,
      familyTravel: Boolean(this.hooks.prepareFamilyTravel),
      emblems: this.catalog.ui?.social?.emblems,
    };
    context.travel = prepared;
    return context;
  }

  async _commit(handler, request, prepared = null) {
    validateRoster(this._stores);
    const profiles = new Map();
    for (const [id, store] of this._stores) {
      profiles.set(id, structuredClone(store.profile));
    }
    const now = Date.now(),
      context = this._context(profiles, request, prepared, now);
    handler(context);
    const ids = [...context.touched],
      stores = ids.map((id) => this._stores.get(id));
    let result;
    const transform = (drafts) => {
      const replacements = new Map();
      for (const [id, store] of this._stores) {
        replacements.set(id, store.profile);
      }
      for (let index = 0; index < ids.length; index++) {
        replacements.set(ids[index], drafts[index]);
      }
      socialRequire(
        !this._closed && (!prepared || prepared.isCurrent()),
        "social-cancelled",
        "The operation's prepared scene is no longer current.",
      );
      const fresh = this._context(replacements, request, prepared, now);
      fresh.allowed = context.touched;
      handler(fresh);
      socialRequire(
        [...fresh.touched].every((id) => context.touched.has(id)),
        "social-conflict",
        "The operation's local participant set changed before commit.",
      );
      result = structuredClone(fresh.result);
    };
    if (stores.length === 1) {
      await stores[0].commitProfile((draft) => transform([draft]));
    } else await ProfileStore.commitCharacters(stores, transform);
    return result;
  }

  medalHook(action) {
    const names = {
      "medal.equip": "equipMedal",
      "medal.challenge": "medalChallenge",
      "medal.forfeit": "medalForfeit",
      "medal.claim": "medalClaim",
    };
    return this.hooks[names[action]];
  }

  medalEntries() {
    const entries = this.hooks.medalEntries?.() ?? [];
    socialRequire(
      Array.isArray(entries) && entries.length <= 4096,
      "medal-catalog",
      "The authored medal quest catalog exceeds its bounded capacity.",
    );
    return structuredClone(entries);
  }

  async _medal(action, payload, actorId) {
    socialRequire(
      actorId === this.store.id,
      "medal-actor",
      "Medal actions require the active local character's gameplay authority.",
    );
    const hook = this.medalHook(action);
    socialRequire(
      hook,
      "medal-authority-unavailable",
      "The authored medal inventory or quest authority is not attached.",
    );
    if (action === "medal.equip") {
      const item = this.store.profile.inventory.find(
        (entry) =>
          entry.uid === payload.uid && Math.floor(entry.id / 10000) === 114,
      );
      socialRequire(item, "medal-missing", "Select an owned unequipped medal.");
    } else {
      socialRequire(
        Number.isInteger(payload.questId) && payload.questId > 0,
        "medal-quest",
        "Select an authored medal quest.",
      );
    }
    const outcome =
      action === "medal.forfeit"
        ? await hook(payload.questId, payload.confirmed === true)
        : await hook(action === "medal.equip" ? payload.uid : payload.questId);
    socialRequire(
      outcome && typeof outcome.ok === "boolean",
      "medal-outcome",
      "The medal authority returned no explicit outcome.",
    );
    return outcome;
  }

  familyRate(kind, actorId = this.store.id, now = Date.now()) {
    socialRequire(
      ["exp", "drop"].includes(kind),
      "family-rate",
      "Choose an EXP or drop family rate.",
    );
    const store = this._stores.get(actorId);
    return store ? familyRate(store.profile, kind, now) : 1;
  }

  recordProgress(event) {
    if (this.busy) {
      return Promise.resolve({
        ok: false,
        code: "social-busy",
        reason:
          "Family progress must be retried by its trusted producer after the pending transaction.",
      });
    }
    this._operation = this._recordProgress(event);
    return this._operation;
  }

  async _recordProgress(event) {
    await Promise.resolve();
    try {
      socialRequire(
        event && ["kill", "boss", "level"].includes(event.kind),
        "family-progress",
        "Unknown trusted family progression event.",
      );
      if (!this.store.profile.social.family) {
        return { ok: true, applied: false };
      }
      const request = {
        actorId: this.store.id,
        requestId: crypto.randomUUID(),
      };
      const result = await this._commit(
        (context) => applyFamilyProgress(context, event),
        request,
      );
      return { ok: true, applied: result.applied ?? false };
    } catch (error) {
      return this._failure(error);
    } finally {
      this._operation = null;
      this._changed();
    }
  }

  resetParticipant() {
    if (this.busy) {
      return Promise.resolve({
        ok: false,
        code: "social-busy",
        reason: "The local social authority is busy or not yet prepared.",
      });
    }
    this._operation = this._resetParticipant();
    return this._operation;
  }

  async _resetParticipant() {
    await Promise.resolve();
    try {
      if (hasSocialLinks(this.store.profile.social)) {
        const fresh = this.store.createResetProfile();
        const request = {
          actorId: this.store.id,
          requestId: crypto.randomUUID(),
        };
        await this._commit(
          (context) => resetSocialParticipant(context, fresh),
          request,
        );
      } else await this.store.reset();
      return { ok: true, location: { ...this.store.profile.location } };
    } catch (error) {
      return this._failure(error);
    } finally {
      this._operation = null;
      this._changed();
    }
  }

  _failure(error) {
    return {
      ok: false,
      code: error?.code ?? "social-failed",
      reason: error?.message ?? "The local social operation failed.",
    };
  }

  async destroy() {
    if (this._closed) return;
    this._closed = true;
    if (this._preparation) {
      await this._preparation.catch((error) => this._report(error));
    }
    if (this._operation) await this._operation;
    for (const unsubscribe of this._unsubscribers.values()) unsubscribe();
    this._unsubscribers.clear();
    this._listeners.clear();
    const outcomes = await Promise.allSettled(
      [...this._stores.values()]
        .filter((store) => store !== this.store)
        .map((store) => store.destroy()),
    );
    this._stores.clear();
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure) throw failure.reason;
  }
}
