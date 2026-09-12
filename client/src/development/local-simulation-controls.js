import { PROFILE_LIMITS } from "../profile/profile-validation.js";
import { PROFILE_DOMAIN_LIMITS } from "../profile/profile-domains.js";
import { CASH_CURRENCIES, CASH_POLICY } from "../items/cash-commerce.js";
import { TRADE_SLOTS, tradeRechargeable } from "../social/local-trade-rules.js";
import { CHAT_CHANNELS } from "../ui/ui-chat.js";
import { CHAT_LIMIT } from "../social/local-chat.js";
import { ItemCatalogControls } from "../ui/ui-inspection.js";

const MAX_PARTICIPANTS = 32;
const MAX_INVITATIONS = 2048;
const MAX_COMMODITY_SN = 2147483647;
const ACTIONS = Object.freeze([
  ["friend.invite", "Send friend invitation", "target"],
  ["party.create", "Create party", "none"],
  ["party.invite", "Invite to party", "target"],
  ["party.leave", "Leave party", "none"],
  ["party.leader", "Transfer party leadership", "target"],
  ["guild.create", "Found guild (six consenting local characters)", "name"],
  ["guild.invite", "Invite to guild", "target"],
  ["guild.leave", "Leave guild", "none"],
  ["guild.disband", "Disband guild", "none"],
  ["alliance.create", "Found Guild Union", "name"],
  ["alliance.invite", "Invite guild leader to Union", "target"],
  ["alliance.leave", "Leave Guild Union", "none"],
  ["family.invite", "Add junior", "target"],
  ["family.sever", "Sever family relationship", "target"],
  ["family.precept", "Set family precept", "text"],
  ["messenger.open", "Open messenger session", "none"],
  ["messenger.invite", "Invite to messenger", "target"],
  ["messenger.send", "Send messenger message", "text"],
  ["messenger.leave", "Leave messenger", "none"],
  ["search.register", "Register party search", "search"],
  ["search.remove", "Stop party search", "none"],
  ["trade.invite", "Peer trade: invite selected target", "target"],
  ["trade.accept", "Peer trade: accept invitation", "trade"],
  ["trade.decline", "Peer trade: decline invitation", "trade"],
  [
    "trade.item",
    "Peer trade: offer owned item (native quantity prompt)",
    "item",
  ],
  ["trade.withdraw", "Peer trade: withdraw offer (cancels room)", "slot"],
  ["trade.mesos", "Peer trade: add mesos (native amount prompt)", "trade"],
  [
    "trade.confirm",
    "Peer trade: confirm own side (native confirmation)",
    "trade",
  ],
  ["trade.cancel", "Peer trade: cancel room", "trade"],
  ["trade.chat", "Peer trade: send room message", "text"],
  ["cash.charge", "Local simulation: fund selected character's cash", "cash"],
  [
    "cash.gift",
    "OUTSIDE-GAME: send cash gift as selected character (NX Prepaid)",
    "gift",
  ],
  [
    "cash.receive",
    "OUTSIDE-GAME: receive selected character's queued cash gift",
    "receipt",
  ],
  ["chat.send", "Local simulation: send chat as selected character", "chat"],
]);

function element(parent, tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}

function labeledInput(parent, label, type = "text") {
  const wrapper = element(parent, "label", label);
  const input = element(wrapper, "input");
  input.type = type;
  input.setAttribute("aria-label", label);
  return input;
}

/** Explicit offline actors are browser controls, never painted into the original game artwork. */
export class LocalSimulationControls {
  constructor(owner, social, interactionHooks) {
    this.owner = owner;
    this.social = social;
    this.interactionHooks = interactionHooks;
    this.trade = null;
    this.unsubscribeTrade = null;
    this.pending = false;
    this.disposed = false;
    this.listeners = [];
    this.seenInvitations = new Set();
    this.root = document.createElement("details");
    this.root.dataset.localSimulation = "";
    element(this.root, "summary", "Local multiplayer simulation");
    element(
      this.root,
      "p",
      "These are real saved local characters, not connected remote players. Every action applies the same admission rules and atomic profile transactions. Peer actions below explicitly select the acting local character; no network delivery is claimed.",
    );
    this.buildCreation();
    this.buildActions();
    this.buildPeerEditor();
    this.status = element(this.root, "p");
    this.status.setAttribute("role", "status");
    this.requests = element(this.root, "div");
    this.requests.style.cssText = "max-height:280px;overflow:auto";
    this.listen(this.root, "keydown", (event) => event.stopPropagation());
    this.listen(this.root, "keyup", (event) => event.stopPropagation());
    this.listen(this.root, "toggle", () => {
      if (this.root.open) this.refresh();
    });
    this.unsubscribe = social.subscribe(() => this.refresh());
    this.refresh();
  }

  listen(target, event, handler) {
    target.addEventListener(event, handler);
    this.listeners.push({ target, event, handler });
  }

  buildCreation() {
    const form = element(this.root, "form");
    this.name = labeledInput(form, "New local character name");
    this.name.maxLength = 12;
    this.createButton = element(form, "button", "Create local character");
    this.createButton.type = "submit";
    this.listen(form, "submit", (event) => {
      event.preventDefault();
      this.run(async () => {
        const result = await this.social.createParticipant(
          this.name.value.trim(),
        );
        if (result.ok) this.name.value = "";
        return result;
      });
    });
  }

  buildActions() {
    const form = element(this.root, "form");
    this.actor = this.select(form, "Act as local character");
    this.target = this.select(form, "Target local character");
    this.action = this.select(form, "Local peer action");
    for (const [value, label] of ACTIONS) {
      const option = element(this.action, "option", label);
      option.value = value;
    }
    this.text = labeledInput(form, "Name or message for selected local action");
    this.text.maxLength = 256;
    this.buildInteractionFields(form);
    this.performButton = element(
      form,
      "button",
      "Perform as selected local character",
    );
    this.performButton.type = "submit";
    this.listen(form, "submit", (event) => {
      event.preventDefault();
      this.run(() => this.perform());
    });
    this.listen(this.actor, "change", () => this.refreshInteraction());
    this.listen(this.action, "change", () => this.refreshInteraction());
    this.listen(this.currency, "change", () => this.refreshInteraction());
    this.listen(this.giftSn, "input", () => this.refreshInteraction());
  }

  select(parent, label) {
    const wrapper = element(parent, "label", label);
    const select = element(wrapper, "select");
    select.setAttribute("aria-label", label);
    return select;
  }

  buildPeerEditor() {
    const section = element(this.root, "fieldset");
    element(section, "legend", "Edit selected local peer");
    element(
      section,
      "p",
      "Select Act as local character above. Peer setup is saved locally; level edits reset EXP to zero. Active-character items must be conjured in the Character panel.",
    );
    this.peerLevel = labeledInput(section, "Peer level", "number");
    this.peerLevel.min = "1";
    this.peerLevel.max = "200";
    this.peerLevel.step = "1";
    this.peerLevel.required = true;
    this.peerSave = element(section, "button", "Save peer level");
    this.peerSave.type = "button";
    this.peerCatalog = new ItemCatalogControls(
      section,
      this.social.catalog.ui.items,
      "Peer inventory item by name or ID",
    );
    this.peerQuantity = labeledInput(section, "Peer item quantity", "number");
    this.peerQuantity.min = "1";
    this.peerQuantity.step = "1";
    this.peerQuantity.required = true;
    this.peerQuantity.value = "1";
    this.peerGrant = element(
      section,
      "button",
      "Add chosen item to peer inventory",
    );
    this.peerGrant.type = "button";
    this.peerOwned = this.select(
      section,
      "Peer owned inventory instance to remove",
    );
    this.peerRemove = element(
      section,
      "button",
      "Remove quantity from chosen peer item",
    );
    this.peerRemove.type = "button";
    this.bindPeerEditor();
  }

  bindPeerEditor() {
    this.listen(this.peerSave, "click", () => {
      if (!this.peerLevel.reportValidity()) return;
      this.run(() =>
        this.social.editParticipant(this.actor.value, {
          kind: "level",
          level: Number(this.peerLevel.value),
        }),
      );
    });
    this.listen(this.peerGrant, "click", () => {
      if (!this.peerQuantity.reportValidity()) return;
      this.run(() =>
        this.social.editParticipant(this.actor.value, {
          kind: "grant",
          itemId: Number(this.peerCatalog.select.value),
          quantity: Number(this.peerQuantity.value),
        }),
      );
    });
    this.listen(this.peerRemove, "click", () => {
      if (!this.peerQuantity.reportValidity()) return;
      this.run(() =>
        this.social.editParticipant(this.actor.value, {
          kind: "remove",
          uid: this.peerOwned.value,
          quantity: Number(this.peerQuantity.value),
        }),
      );
    });
    this.listen(this.peerCatalog.search, "input", () => this.updatePending());
  }

  buildInteractionFields(form) {
    this.item = this.select(form, "Owned inventory instance to offer");
    this.slot = this.select(form, `Trade offer slot (1–${TRADE_SLOTS})`);
    this.currency = this.select(form, "Local cash currency");
    const labels = ["NX Credit", "Maple Points", "NX Prepaid"];
    for (let index = 0; index < CASH_CURRENCIES.length; index++) {
      const option = element(
        this.currency,
        "option",
        `${labels[index]} (${CASH_CURRENCIES[index]})`,
      );
      option.value = CASH_CURRENCIES[index];
    }
    this.amount = labeledInput(form, "Local cash funding amount", "number");
    this.amount.min = "1";
    this.amount.max = String(PROFILE_DOMAIN_LIMITS.cashBalance);
    this.amount.step = "1";
    this.amount.value = "1";
    this.buildCashGiftFields(form);
    this.channel = this.select(form, "Local chat channel");
    for (let index = 0; index < CHAT_CHANNELS.length; index++) {
      const option = element(this.channel, "option", CHAT_CHANNELS[index]);
      option.value = String(index);
    }
    this.channel.value = "7";
    this.interactionState = element(form, "div");
    element(
      form,
      "p",
      "Peer simulation only. Items come from the acting character's saved inventory. Item quantities, added mesos and trade confirmation use the native prompts. Withdrawing an offered item cancels the whole room. Cash funding is an explicit local balance edit, not a payment. Outside-game gifts spend the selected character's NX Prepaid on original commodities; receiving consumes a real saved gift into that character's cash locker. Neither action switches the active character or claims remote delivery.",
    );
  }

  buildCashGiftFields(form) {
    this.giftSn = labeledInput(form, "Original commodity SN", "number");
    this.giftSn.min = "1";
    this.giftSn.max = String(MAX_COMMODITY_SN);
    this.giftSn.step = "1";
    this.giftMessage = labeledInput(form, "Cash gift message");
    this.giftMessage.maxLength = CASH_POLICY.message;
    this.giftReceipt = this.select(
      form,
      "Selected character's saved cash gift to receive",
    );
  }

  perform() {
    const entry = ACTIONS.find(([action]) => action === this.action.value);
    if (!entry) throw new Error("Unknown local simulation action");
    if (!this.social.getParticipant(this.actor.value)) {
      throw new Error("Select an existing local character.");
    }
    if (entry[0] === "trade.invite") {
      return this.interactionHooks.openTrade(
        this.actor.value,
        this.target.value,
      );
    }
    if (entry[0].startsWith("trade.")) return this.performTrade(entry[0]);
    if (entry[0] === "cash.charge") return this.performCharge();
    if (entry[0] === "cash.gift") return this.performGift();
    if (entry[0] === "cash.receive") {
      return this.interactionHooks.cashReceive(
        this.actor.value,
        this.giftReceipt.value,
      );
    }
    if (entry[0] === "chat.send") {
      return this.interactionHooks.chat(
        this.actor.value,
        this.text.value,
        Number(this.channel.value),
        this.target.value,
      );
    }
    return this.performSocial(entry);
  }

  performSocial(entry) {
    const payload = { actorId: this.actor.value };
    if (entry[2] === "target") payload.targetId = this.target.value;
    if (entry[2] === "name") payload.name = this.text.value.trim();
    if (entry[2] === "text") payload.text = this.text.value;
    if (entry[2] === "search") {
      payload.minLevel = 1;
      payload.maxLevel = 200;
      payload.jobs = [];
      payload.text = this.text.value;
    }
    return this.social.execute(entry[0], payload);
  }

  performTrade(action) {
    const trade = this.interactionHooks.trade();
    const store = this.social.getParticipant(this.actor.value);
    const side = trade?.stores.indexOf(store) ?? -1;
    if (side < 0) {
      return {
        ok: false,
        reason:
          "The acting character is not a participant in the current local trade.",
      };
    }
    switch (action) {
      case "trade.accept":
        return trade.accept(side);
      case "trade.decline":
        return trade.decline(side);
      case "trade.item":
        return trade.promptItem(side, {
          uid: this.item.value,
          slot: Number(this.slot.value),
        });
      case "trade.withdraw":
        return trade.removeOffer(side, Number(this.slot.value));
      case "trade.mesos":
        return trade.promptMesos(side);
      case "trade.confirm":
        return trade.confirm(side);
      case "trade.cancel":
        return trade.cancel(side);
      case "trade.chat":
        return trade.sendChat(side, this.text.value);
      default:
        throw new Error("Unknown peer trade action");
    }
  }

  performCharge() {
    const amount = Number(this.amount.value);
    if (
      !CASH_CURRENCIES.includes(this.currency.value) ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > PROFILE_DOMAIN_LIMITS.cashBalance
    ) {
      return {
        ok: false,
        reason:
          "Select a cash currency and a positive whole amount within the local cash balance limit.",
      };
    }
    return this.interactionHooks.charge(
      this.actor.value,
      this.currency.value,
      amount,
    );
  }

  performGift() {
    const sn = Number(this.giftSn.value);
    if (!Number.isSafeInteger(sn) || sn < 1 || sn > MAX_COMMODITY_SN) {
      return { ok: false, reason: "Enter a valid original commodity SN." };
    }
    return this.interactionHooks.cashGift(this.actor.value, {
      sn,
      targetId: this.target.value,
      message: this.giftMessage.value,
    });
  }

  async run(action) {
    if (this.pending || this.disposed) return;
    this.pending = true;
    this.updatePending();
    try {
      const result = await action();
      if (!this.disposed) this.showResult(result);
    } catch (error) {
      if (!this.disposed) this.status.textContent = error.message;
      this.owner.report?.(error);
    } finally {
      this.pending = false;
      if (!this.disposed) {
        try {
          this.refresh();
        } catch (error) {
          this.status.textContent = error.message;
          this.owner.report?.(error);
        }
      }
    }
  }

  showResult(result) {
    const accepted = result?.ok === true || result?.accepted === true;
    this.status.textContent = accepted
      ? `Local action accepted${result.state ? ` (${result.state})` : ""}${result.delivery ? `: ${result.delivery}` : "."}`
      : result?.reason || result?.code || "The local action was not accepted.";
  }

  refresh() {
    if (this.disposed) return;
    const participants = this.social.participants();
    if (participants.length > MAX_PARTICIPANTS) {
      throw new Error("Local participant budget exceeded");
    }
    this.populate(this.actor, participants);
    this.populate(this.target, participants);
    this.refreshInteraction();
    this.requests.replaceChildren();
    const invitations = this.social.invitations();
    if (invitations.length > MAX_INVITATIONS) {
      throw new Error("Local invitation budget exceeded");
    }
    if (!invitations.length) {
      element(this.requests, "p", "No pending local invitations.");
    }
    for (const request of invitations) this.invitationRow(request);
    this.updatePending();
    this.offerPrimaryInvitation(invitations);
  }

  refreshInteraction() {
    if (this.disposed) return;
    const trade = this.interactionHooks.trade();
    this.observeTrade(trade);
    const store = this.social.getParticipant(this.actor.value);
    const side = trade?.stores.indexOf(store) ?? -1;
    this.populateItems(store, trade);
    this.refreshPeerLevel(store);
    this.populateSlots(trade, side);
    this.interactionState.replaceChildren();
    if (trade) this.tradeState(trade);
    else element(this.interactionState, "p", "No current local trade.");
    if (store) {
      const balances = store.profile.cash.balances;
      element(
        this.interactionState,
        "p",
        `${store.profile.name}: ${store.profile.meso} mesos; NX Credit ${balances.credit}; Maple Points ${balances.points}; NX Prepaid ${balances.prepaid}.`,
      );
    }
    this.refreshCashGifts(store);
    this.showInteractionMode();
    this.updatePending();
  }

  refreshPeerLevel(store) {
    if (
      this.peerActor === store?.id &&
      this.peerSavedLevel === store?.profile.level
    ) {
      return;
    }
    this.peerActor = store?.id;
    this.peerSavedLevel = store?.profile.level;
    this.peerLevel.value = store ? String(store.profile.level) : "";
  }

  refreshCashGifts(store) {
    if (this.action.value === "cash.gift") this.describeCashGift();
    if (this.action.value !== "cash.receive") return;
    const selected = this.giftReceipt.value;
    const gifts = store?.profile.cash.gifts ?? [];
    if (gifts.length > CASH_POLICY.gifts) {
      throw new Error("Local cash gift option budget exceeded");
    }
    this.giftReceipt.replaceChildren();
    for (const gift of gifts) {
      const offer = this.social.catalog.ui.cashShop.commodities[gift.sn];
      const template = this.social.catalog.ui.items[offer?.itemId];
      const option = element(
        this.giftReceipt,
        "option",
        `From ${gift.senderName}: ${template?.name ?? `SN ${gift.sn}`} — ${gift.message} — saved gift ${gift.uid}`,
      );
      option.value = gift.uid;
    }
    if (gifts.some((gift) => gift.uid === selected)) {
      this.giftReceipt.value = selected;
    }
    if (!gifts.length) {
      element(this.giftReceipt, "option", "No queued cash gifts").value = "";
    }
  }

  describeCashGift() {
    const sn = Number(this.giftSn.value);
    const offer = this.social.catalog.ui.cashShop.commodities[sn];
    const template = this.social.catalog.ui.items[offer?.itemId];
    element(
      this.interactionState,
      "p",
      offer
        ? `Original SN ${offer.sn}: ${template?.name ?? offer.itemId}, count ${offer.count}, price ${offer.price} ${offer.category === 8 ? "Mesos" : "NX"}. Gifts use NX Prepaid; normal gift eligibility is checked on submission.`
        : "Enter an Original commodity SN from the Cash Shop catalog; no item or price is invented.",
    );
  }

  observeTrade(trade) {
    if (trade === this.trade) return;
    this.unsubscribeTrade?.();
    this.trade = trade;
    this.unsubscribeTrade = trade
      ? trade.subscribe(() => this.refreshInteraction())
      : null;
  }

  showInteractionMode() {
    const mode = ACTIONS.find(([action]) => action === this.action.value)?.[2];
    this.item.parentElement.hidden = mode !== "item";
    this.slot.parentElement.hidden = mode !== "item" && mode !== "slot";
    this.currency.parentElement.hidden = mode !== "cash";
    this.amount.parentElement.hidden = mode !== "cash";
    this.amount.disabled = mode !== "cash";
    this.channel.parentElement.hidden = mode !== "chat";
    this.giftSn.parentElement.hidden = mode !== "gift";
    this.giftSn.disabled = mode !== "gift";
    this.giftMessage.parentElement.hidden = mode !== "gift";
    this.giftMessage.disabled = mode !== "gift";
    this.giftReceipt.parentElement.hidden = mode !== "receipt";
    this.giftReceipt.disabled = mode !== "receipt";
    this.text.parentElement.hidden = ![
      "name",
      "text",
      "search",
      "chat",
    ].includes(mode);
    this.text.maxLength = mode === "chat" ? CHAT_LIMIT : 256;
    this.target.parentElement.hidden = !["target", "chat", "gift"].includes(
      mode,
    );
  }

  populateItems(store, trade) {
    const selected = this.item.value;
    const inventory = store?.profile.inventory ?? [];
    if (inventory.length > PROFILE_LIMITS.inventory) {
      throw new Error("Local inventory option budget exceeded");
    }
    this.item.replaceChildren();
    for (const item of inventory) this.itemOption(item, trade);
    const owned = this.peerOwned.value;
    this.peerOwned.replaceChildren();
    for (const option of this.item.options) {
      this.peerOwned.append(option.cloneNode(true));
    }
    if (inventory.some((item) => item.uid === owned)) {
      this.peerOwned.value = owned;
    }
    if (inventory.some((item) => item.uid === selected)) {
      this.item.value = selected;
    }
    if (!inventory.length) {
      element(this.item, "option", "No owned inventory items").value = "";
    }
  }

  itemOption(item, trade) {
    const template =
      trade?.catalog.ui?.items?.[item.id] ??
      this.social.catalog.ui?.items?.[item.id];
    const option = element(
      this.item,
      "option",
      `${template?.name ?? item.id} — item ${item.id}, inventory slot ${item.slot}, count ${item.count}${tradeRechargeable(item.id) ? " (whole stack only)" : ""} — ${item.uid}`,
    );
    option.value = item.uid;
  }

  populateSlots(trade, side) {
    const selected = this.slot.value;
    this.slot.replaceChildren();
    for (let slot = 1; slot <= TRADE_SLOTS; slot++) {
      const offer = side < 0 ? null : trade.offers[side][slot - 1];
      const option = element(
        this.slot,
        "option",
        `${slot}: ${offer ? `item ${offer.item.id} × ${offer.count}` : "empty"}`,
      );
      option.value = String(slot);
    }
    if (Number(selected) >= 1 && Number(selected) <= TRADE_SLOTS) {
      this.slot.value = selected;
    }
  }

  tradeState(trade) {
    const snapshot = trade.snapshot();
    element(
      this.interactionState,
      "p",
      `Local trade: ${snapshot.state}. Each participant must explicitly accept or confirm their own side.`,
    );
    for (const participant of snapshot.participants) {
      const offers = participant.offers
        .filter(Boolean)
        .map(
          (offer) =>
            `slot ${offer.slot}: item ${offer.item.id} × ${offer.count}`,
        )
        .join("; ");
      element(
        this.interactionState,
        "p",
        `${participant.name} (${participant.side === 0 ? "inviter" : "invitee"}): ${participant.locked ? "confirmed" : "not confirmed"}${participant.prompting ? ", native prompt open" : ""}; ${participant.mesos} mesos offered, fee ${participant.fee}; ${offers || "no items offered"}.`,
      );
    }
  }

  offerPrimaryInvitation(invitations) {
    const current = new Set(invitations.map((request) => request.id));
    for (const id of this.seenInvitations) {
      if (!current.has(id)) this.seenInvitations.delete(id);
    }
    const active = this.owner.socialInvitation;
    if (active && !current.has(active.request.id)) active.answer(null);
    if (
      this.pending ||
      this.social.snapshot().busy ||
      this.owner.modal() ||
      this.owner.closingAll ||
      this.owner.hooks.isOperationPending?.()
    ) {
      return;
    }
    const request = invitations.find(
      (request) => request.incoming && !this.seenInvitations.has(request.id),
    );
    if (!request) return;
    this.seenInvitations.add(request.id);
    this.run(async () => {
      const accepted = await this.promptInvitation(request);
      if (this.disposed || (accepted !== true && accepted !== false)) {
        return { ok: false, code: "cancelled" };
      }
      return this.social.execute(
        accepted ? "invitation.accept" : "invitation.decline",
        { invitationId: request.invitationId },
      );
    });
  }

  async promptInvitation(request) {
    let invitation;
    try {
      return await new Promise((resolve, reject) => {
        invitation = { request, answer: resolve };
        this.owner.socialInvitation = invitation;
        this.owner.open("SocialInvitation").catch(reject);
      });
    } finally {
      if (this.owner.socialInvitation === invitation) {
        this.owner.close("SocialInvitation", true);
        this.owner.socialInvitation = null;
      }
    }
  }

  populate(select, participants) {
    const selected = select.value;
    select.replaceChildren();
    for (const participant of participants) {
      const option = element(
        select,
        "option",
        `${participant.name} — Lv. ${participant.level} — ${participant.mapName}`,
      );
      option.value = participant.id;
    }
    if (participants.some((participant) => participant.id === selected)) {
      select.value = selected;
    }
  }

  invitationRow(request) {
    const row = element(this.requests, "div");
    element(
      row,
      "span",
      `${request.fromName} → ${request.toName}: ${request.kind}${request.groupName ? ` (${request.groupName})` : ""} `,
    );
    for (const [action, label] of [
      ["invitation.accept", "Accept"],
      ["invitation.decline", "Decline"],
    ]) {
      const button = element(row, "button", `${label} as ${request.toName}`);
      button.type = "button";
      button.addEventListener("click", () =>
        this.run(() =>
          this.social.execute(action, {
            actorId: request.toId,
            invitationId: request.invitationId,
          }),
        ),
      );
    }
  }

  updatePending() {
    const busy = this.pending || this.social.snapshot().busy;
    for (const button of this.root.querySelectorAll("button")) {
      button.disabled = busy;
    }
    const actor = this.social.getParticipant(this.actor.value);
    const unavailable = busy || !actor || actor === this.social.store;
    this.peerSave.disabled = unavailable;
    this.peerGrant.disabled =
      unavailable || !this.peerCatalog.select.options.length;
    this.peerRemove.disabled = unavailable || !this.peerOwned.value;
    this.peerLevel.disabled = unavailable;
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.owner.socialInvitation?.answer(null);
    this.peerCatalog.destroy();
    this.unsubscribe();
    this.unsubscribeTrade?.();
    this.unsubscribeTrade = null;
    this.trade = null;
    for (const { target, event, handler } of this.listeners) {
      target.removeEventListener(event, handler);
    }
    this.listeners.length = 0;
    this.root.remove();
  }
}
