import { CharacterDevelopment } from "./character/character-development.js";
import { QuestSystem } from "./quests/quest-system.js";
import { questEndpointNpc } from "./quests/quest-journal-model.js";
import { InventoryActions } from "./items/inventory-actions.js";
import { LocalSocial } from "./social/local-social.js";
import { CashShopService } from "./items/cash-shop.js";
import { MonsterBookService } from "./character/monster-book.js";
import { SkillMacros } from "./skills/skill-macros.js";
import { NpcInteractions } from "./npc/npc-interactions.js";
import { LocalTrade } from "./social/local-trade.js";
import { LocalSimulationControls } from "./development/local-simulation-controls.js";
import { NativeAvatarPortrait } from "./ui/ui-avatar-portrait.js";
import {
  createCharacterStats,
  projectCharacterStats,
} from "./character/character-stats.js";
import { LocalChat } from "./social/local-chat.js";
import { createHitboxState, updateHitboxes } from "./physics/hitboxes.js";
import { ProfileStore } from "./profile/profile-store.js";

const AP_WARNING =
  "If you invest your AP in HP or MP, your character may have\r\ninsufficient stats to become as strong as it could be.\r\nDo you still wish to raise this skill?";
const EQUIP_WARNING =
  "You cannot trade this item after equipping.\r\n Do you still wish to equip?";

const MAX_FAMILY_PROGRESS = 512;
/** Model getters keep the native window layer independent of field/profile replacement. */
export function nativeInterfaceHooks(owner) {
  return {
    social: () => owner.native.social,
    cashShop: () => owner.native.cash,
    monsterBook: () => owner.native.book,
    macros: () => owner.native.macros,
    inventoryActions: () => owner.native.inventory,
    shop: () => owner.native.npc.shop,
    storage: () => owner.native.npc.storage,
    skillUtilities: () => owner.scene.fieldSystems.skills.utilityController,
    trade: () => owner.native.trade,
    isOperationPending: (excluded) => owner.isOperationPending(excluded),
    mapName: (id) => owner.catalog?.mapNames[Number(id)] ?? null,
    apAdmission: (target) => owner.native.development.apAdmission(target),
    spendAp: (target, options) =>
      owner.native.development.spendAp(target, options),
    confirmAp: () => owner.ui.prompt({ kind: "confirm", text: AP_WARNING }),
    characterStats: () => owner.native.characterStats(),
    userInfoProfile: () => owner.native.userInfoStore().profile,
    userInfoPortrait: (surface, position) =>
      owner.native.portrait(surface, position),
    userInfoFamily: (profile) => owner.native.openUserFamily(profile),
    userInfoParty: (profile) => owner.native.inviteUserParty(profile),
    userInfoGift: (profile, sn) => owner.native.giftUserWish(profile, sn),
    openUserInfoAt: (x, y) => owner.native.openUserInfoAt(x, y),
    openFamilyTree: (id) => owner.native.openFamilyTree(id),
    familyTreeTarget: () => owner.native.familyTreeId,
    socialPartyHp: (enabled) => owner.native.togglePartyHP(enabled),
    tradePortrait: (surface, options) =>
      owner.native.portrait(surface, options),
    socialPortrait: (request) => owner.native.socialPortrait(request),
    openLocalTrade: (id) => owner.native.openTrade(id),
    socialOpenUserInfo: (id) => owner.native.openUserInfo(id),
    socialOutcome: (result) =>
      result.dialogue
        ? owner.native.npc.showQuestDialogue(result.dialogue)
        : null,
    confirmQuestGiveUp: (id, name) =>
      owner.ui.prompt({
        kind: "confirm",
        text: `Do you really want to forfeit "${name}"?`,
      }),
    markQuestNpc: (id) => owner.native.markQuestNpc(id),
    socialChat: (request) => owner.native.selectChat(request),
    tradeOutcome: (result) =>
      owner.ui.prompt({
        kind: "notice",
        text: result.text ?? result.reason,
        owner: owner.native.trade,
      }),
    onCloseWindow: (name) => owner.native?.windowClosed(name),
    applyAudioSettings: (settings) => owner.applyAudioSettings(settings),
  };
}

/** One retained profile's native controllers. Scenes borrow this owner across map candidates. */
export class NativeInterfaces {
  constructor(owner, store) {
    this.owner = owner;
    this.store = store;
    this.references = 0;
    this.destroyed = false;
    this.inventoryUse = false;
    this.inventoryDrop = false;
    this.medalEquipment = false;
    this.familyQueue = Array.from({ length: MAX_FAMILY_PROGRESS }, () => ({
      kind: "kill",
      maxHp: 0,
    }));
    this.familyHead = 0;
    this.familyCount = 0;
    this.familyWork = null;
    this.familyError = null;
    this.trade = null;
    this.cashAccountService = null;
    this.trackerDirty = true;
    this.trackerWork = null;
    this.trackerOpen = null;
    this.trackerInventory = null;
    this.trackerQuests = null;
    this.trackerSettings = null;
    this.trackerLevel = null;
    this.userInfoId = store.id;
    this.familyTreeId = store.id;
    this.selectionHitboxes = createHitboxState();
    this.selectionPoint = { x: 0, y: 0 };
    this.selectionPrevious = { x: 0, y: 0 };
    this.selectionContext = { previousPosition: this.selectionPrevious };
    this.stats = createCharacterStats();
    this.statsHooks = {
      items: owner.catalog.ui.items,
      derivedStats: () => owner.scene?.fieldSystems.skills.derived(),
      skillLevel: (id) => owner.scene?.fieldSystems.skills.level(id) ?? 0,
      skillInfo: (id) => owner.scene?.fieldSystems.skills.info(id),
    };
    this.initializeControllers();
    this.unsubscribeTracker = store.subscribe(
      this.trackProfileChanges.bind(this),
    );
  }

  /** Cosmic account-level query maps to this browser's local character roster.
   * Temporary previews remain isolated from the durable account. */
  async hasLevel30Character() {
    if (this.store.profile.level >= 30) return true;
    if (this.store.temporary) return false;
    const entries = await ProfileStore.listCharacters({
      items: this.owner.catalog.ui.items,
    });
    for (const entry of entries) {
      if (entry.id === this.store.id) continue;
      if (entry.error) {
        throw new Error(
          `Tutorial account character is unreadable: ${entry.id}`,
        );
      }
      if (entry.level >= 30) return true;
    }
    return this.store.profile.level >= 30;
  }

  initializeControllers() {
    const { owner, store } = this;
    this.development = new CharacterDevelopment(store, owner.catalog, {
      random: owner.hooks.random,
      isBusy: () => this.isBusy(this.development),
    });
    this.quests = new QuestSystem(owner.catalog.quests, store, {
      onChange: () => {
        this.trackerDirty = true;
        owner.profileChanged();
      },
      onEffect: owner.playEffect,
      onError: owner.hooks.onError,
      items: owner.catalog.ui.items,
      mapName: (id) => owner.catalog.mapNames[Number(id)] ?? null,
      growth: (profile) => owner.scene?.fieldSystems.skills.growth(profile),
      onReward: (result) => owner.publishQuestReward(result),
    });
    this.npc = new NpcInteractions(owner, store);
    this.inventory = this.createInventory();
    this.social = this.createSocial();
    this.cash = this.createCash();
    this.book = new MonsterBookService(store, owner.catalog, {
      isBusy: () => this.isBusy(this.book),
      onChange: owner.profileChanged,
    });
    this.chat = new LocalChat(store, this.social, {
      getTargetId: () => this.chatTargetId,
      fieldSpeech: (text) => owner.submitFieldSpeech(text),
      receive: (record) => owner.ui.chat.receive(record),
      now: () => owner.hooks.now?.() ?? performance.now(),
      isBusy: () => this.isBusy(this.chat) || owner.ui.blocksGameplay(),
      onError: owner.hooks.onError,
    });
    this.macros = new SkillMacros(store, owner.catalog, {
      skillSystem: () => owner.scene?.fieldSystems.skills,
      isBusy: () => this.isBusy(this.macros) || owner.ui.blocksGameplay(),
      onChat: (text) => owner.ui.chat.submitText(text, 7),
      onError: owner.hooks.onError,
    });
    this.controllers = [
      this.npc,
      this.inventory,
      this.social,
      this.cash,
      this.book,
      this.macros,
      this.chat,
    ];
  }

  async prepare() {
    await this.social.prepare();
    return this;
  }

  activate() {
    this.trackerDirty = true;
    this.trackerOpen = null;
    if (!this.controls) {
      this.controls = new LocalSimulationControls(this.owner.ui, this.social, {
        trade: () => this.trade,
        openTrade: (actorId, targetId) => this.openTrade(targetId, actorId),
        charge: (actorId, currency, amount) =>
          this.charge(actorId, currency, amount),
        cashGift: (actorId, request) => this.cashGift(actorId, request),
        cashReceive: (actorId, giftId) => this.cashReceive(actorId, giftId),
        chat: (actorId, text, channel, targetId) =>
          this.chat.submitAs(actorId, text, channel, targetId),
      });
    }
    this.owner.ui.profileControls.scroll.append(this.controls.root);
    this.controls.root.hidden = false;
  }

  pending(excluded = null) {
    if (this.trackerWork && excluded !== this.quests) return true;
    if (this.cashAccountService && this.cashAccountService !== excluded) {
      return true;
    }
    for (const controller of this.controllers) {
      if (this.excludesController(controller, excluded)) continue;
      if (controller.pending || controller.saving) return true;
    }
    return this.trade !== excluded && !!this.trade?.pending;
  }

  excludesController(controller, excluded) {
    // No exclusion must not match an absent NPC child controller.
    if (excluded === null) return false;
    if (controller === excluded) return true;
    if (controller === this.npc) {
      return this.npc.shop === excluded || this.npc.storage === excluded;
    }
    if (controller === this.inventory) {
      return this.inventoryDelegatesTo(excluded);
    }
    if (controller === this.social) {
      return this.medalEquipment && excluded === this.inventory;
    }
    if (controller === this.chat) {
      return this.chat.delegatingSocial && excluded === this.social;
    }
    return false;
  }

  inventoryDelegatesTo(excluded) {
    return (
      (this.inventoryUse && excluded === this.owner.bindings?.items) ||
      (this.inventoryDrop && excluded === this.owner.scene?.fieldSystems.drops)
    );
  }

  ownsOperation(controller) {
    return (
      controller === this.development ||
      controller === this.cashAccountService ||
      controller === this.trade ||
      controller === this.npc.shop ||
      controller === this.npc.storage ||
      this.controllers.includes(controller)
    );
  }

  isBusy(excluded = null) {
    return (
      this.destroyed ||
      this.owner.native !== this ||
      !this.owner.scene ||
      this.owner.hooks.isTransitioning() ||
      this.owner.isOperationPending(excluded)
    );
  }

  current() {
    return (
      !this.destroyed &&
      this.owner.native === this &&
      !!this.owner.scene &&
      this.owner.store === this.store
    );
  }

  createInventory() {
    return new InventoryActions(this.store, this.owner.catalog, {
      isCurrent: () => this.current(),
      isBusy: () => this.isBusy(this.inventory),
      prepareAppearance: (draft) => this.owner.prepareAppearance(draft),
      publishAppearance: (prepared) => this.owner.publishAppearance(prepared),
      releaseAppearance: (prepared) => prepared.destroy(),
      confirmEquipment: () =>
        this.owner.ui.prompt({
          kind: "confirm",
          text: EQUIP_WARNING,
          owner: this.inventory,
        }),
      useItem: (id, uid) => this.useItem(id, uid),
      dropItem: (request) => this.dropItem(request),
    });
  }

  createSocial() {
    return new LocalSocial(this.store, this.owner.catalog, {
      temporaryPeers: () => this.owner.hooks.temporaryPeers?.() ?? [],
      isBusy: () => this.isBusy(this.social),
      onError: this.owner.hooks.onError,
      medalEntries: () => this.quests.medalEntries(),
      equipMedal: (uid) => this.equipMedal(uid),
      medalChallenge: (id) => this.quests.medalChallenge(id),
      medalClaim: (id) => this.quests.medalClaim(id),
      medalForfeit: (id, confirmed) => this.quests.medalForfeit(id, confirmed),
      familyRates: true,
      prepareFamilyTravel: (request) =>
        this.owner.hooks.prepareFamilyTravel(request, this.social),
    });
  }

  createCash(store = this.store) {
    const service = new CashShopService(store, this.owner.catalog, {
      isBusy: () => this.isBusy(service),
      onChange: this.owner.profileChanged,
      onError: this.owner.hooks.onError,
      getParticipant: (id) => this.social.getParticipant(id),
      participants: () => this.social.participants(),
      socialSnapshot: () => this.social.snapshot(),
      preparePreview: (request) => this.owner.avatars.preparePreview(request),
    });
    return service;
  }

  async equipMedal(uid) {
    this.medalEquipment = true;
    try {
      return await this.inventory.equip({ uid });
    } finally {
      this.medalEquipment = false;
    }
  }

  async useItem(id, uid) {
    this.inventoryUse = true;
    try {
      if (Math.floor(id / 10000) === 500) {
        return await this.owner.scene.fieldSystems.skills.utilityController.pets.toggle(
          uid,
        );
      }
      return await this.owner.bindings.items.use(id, uid);
    } finally {
      this.inventoryUse = false;
    }
  }

  async dropItem(request) {
    this.inventoryDrop = true;
    try {
      return await this.owner.scene.fieldSystems.drops.dropItem(
        request,
        this.owner.scene.simulation,
      );
    } finally {
      this.inventoryDrop = false;
    }
  }

  characterStats() {
    return projectCharacterStats(
      this.store.profile,
      this.statsHooks,
      this.stats,
    );
  }

  userInfoStore() {
    const selected = this.social.getParticipant(this.userInfoId);
    if (!selected) {
      throw new Error("The selected local character is no longer loaded");
    }
    return selected;
  }

  portrait(surface, options) {
    return new NativeAvatarPortrait(surface, this.owner.avatars, options);
  }

  socialPortrait({ layer, member, x, y }) {
    const participant = this.social.getParticipant(member.id);
    if (!participant) {
      throw new Error("The Messenger character is no longer loaded");
    }
    const portrait = this.portrait(layer, { x, y, id: participant.id });
    portrait.useSurfaceClock();
    portrait.refresh(participant.profile).catch((error) => {
      if (error.name !== "AbortError") this.owner.hooks.onError(error);
    });
    return portrait;
  }

  async openUserInfo(id = this.store.id) {
    if (!this.social.getParticipant(id)) {
      return {
        ok: false,
        reason: "The selected local character is not loaded.",
      };
    }
    this.userInfoId = id;
    const panel = await this.owner.ui.open("UserInfo");
    panel.localRefresh();
    this.owner.ui.front(panel);
    return { ok: true };
  }

  /** 0094cf7a/0094fbbf: left double-click selects the swept0045183b receiver. */
  async openUserInfoAt(clientX, clientY) {
    if (this.isBusy() || this.owner.ui.blocksGameplay()) return false;
    const { app, scene } = this.owner;
    const bounds = app.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    const point = this.selectionPoint,
      sim = scene.simulation;
    point.x = ((clientX - bounds.left) * app.screen.width) / bounds.width;
    point.y = ((clientY - bounds.top) * app.screen.height) / bounds.height;
    scene.container.toLocal(point, undefined, point);
    this.selectionPrevious.x = sim.previousX;
    this.selectionPrevious.y = sim.previousY;
    updateHitboxes(this.selectionHitboxes, sim, this.selectionContext);
    const body = this.selectionHitboxes.body;
    if (
      !body.active ||
      point.x < body.left ||
      point.x >= body.right ||
      point.y < body.top ||
      point.y >= body.bottom
    ) {
      return false;
    }
    return (await this.openUserInfo(this.store.id)).ok;
  }

  async openUserFamily(profile) {
    const selected = this.userInfoStore();
    if (selected.profile !== profile) {
      return { ok: false, reason: "The selected character changed." };
    }
    if (selected !== this.store) return this.openFamilyTree(selected.id);
    await this.owner.ui.open("Family");
    return { ok: true };
  }

  inviteUserParty(profile) {
    const selected = this.userInfoStore();
    if (selected.profile !== profile) {
      return { ok: false, reason: "The selected character changed." };
    }
    const party = this.store.profile.social.party;
    if (!party || party.leaderId !== this.store.id) {
      return {
        ok: false,
        reason: "Only a party leader can invite a character.",
      };
    }
    return this.social.execute("party.invite", { targetId: selected.id });
  }

  /** 008fe30d stores the selected name/SN before entering the Cash Shop gift dialog. */
  async giftUserWish(profile, sn) {
    const selected = this.userInfoStore();
    if (
      selected.profile !== profile ||
      selected === this.store ||
      !profile.cash.wishlist.includes(sn)
    ) {
      return {
        ok: false,
        reason: "Select another character's saved wish-list item.",
      };
    }
    const name = profile.name;
    if (!(await this.openCash())) {
      return { ok: false, reason: "The character is busy." };
    }
    const panel = this.owner.ui.windows.get("CashShop");
    return panel.cashOpenGift(sn, name)
      ? { ok: true }
      : {
          ok: false,
          reason: "Finish or cancel the current Cash Shop dialog first.",
        };
  }

  async openFamilyTree(id = this.store.id) {
    if (!this.social.getParticipant(id)) {
      return {
        ok: false,
        reason: "The selected local character is not loaded.",
      };
    }
    this.familyTreeId = id;
    const panel = await this.owner.ui.open("FamilyTree");
    const result = panel.setFamilyRoot(id);
    if (result.ok) this.owner.ui.front(panel);
    return result;
  }

  async togglePartyHP(enabled) {
    if (this.isBusy()) return { ok: false, reason: "The character is busy." };
    if (enabled && !this.social.snapshot().party) {
      return { ok: false, reason: "The character is not in a party." };
    }
    const ok = enabled
      ? !!(await this.owner.ui.open("PartyHP"))
      : this.owner.ui.close("PartyHP");
    this.owner.ui.windows.get("UserList")?.localRefresh?.();
    return { ok };
  }

  async markQuestNpc(id) {
    const record = this.quests.catalog.records[id];
    if (!record) {
      throw new Error("The selected quest is not in the original catalog");
    }
    const npcId = questEndpointNpc(
      record,
      this.quests.store.profile.quests[id]?.state ?? 0,
    );
    const opened = this.owner.ui.windows.has("WorldMap");
    const panel = await this.owner.ui.open("WorldMap");
    const result = panel.markNpc(npcId);
    if (!result.ok) {
      if (!opened) this.owner.ui.close("WorldMap");
      await this.owner.ui.prompt({
        kind: "notice",
        text: "This NPC is located at a spot not\r\navailable through the World Map.",
        owner: panel,
      });
    }
    return result;
  }

  selectChat({ channel, targetId, groupId } = {}) {
    const channels = {
      buddy: 0,
      group: 1,
      party: 2,
      guild: 3,
      alliance: 4,
      spouse: 5,
      whisper: 6,
      all: 7,
    };
    const index = groupId !== undefined ? 1 : channels[channel];
    if (index === undefined) {
      return { ok: false, reason: "Unknown original chat channel." };
    }
    if (targetId && !this.social.getParticipant(targetId)) {
      return { ok: false, reason: "The local recipient is not loaded." };
    }
    this.chatTargetId =
      groupId !== undefined ? `group:${groupId}` : (targetId ?? null);
    this.owner.ui.chat.selector.selectedIndex = index;
    this.owner.ui.chat.open();
    return { ok: true };
  }

  async openTrade(targetId = null, actorId = this.store.id) {
    if (
      this.isBusy() ||
      this.owner.ui.modal() ||
      this.owner.tradeSession.isBusy(this.store.id)
    ) {
      return { ok: false, reason: "The character is busy." };
    }
    targetId = await this.selectTradeTarget(targetId);
    if (targetId === null) return { ok: false, code: "cancelled" };
    const peer = this.social.getParticipant(targetId);
    const actor = this.social.getParticipant(actorId);
    const reason = this.tradeParticipantError(actor, peer);
    if (reason) return { ok: false, reason };
    const previous = this.trade;
    if (previous) {
      this.owner.ui.close("TradeInvitation", true);
      this.owner.ui.close("TradingRoom", true);
      await previous.destroy();
    }
    const trade = new LocalTrade([actor, peer], this.owner.catalog, {
      session: this.owner.tradeSession,
      prompt: (request) => this.owner.ui.prompt({ ...request, owner: trade }),
      isBusy: () => this.isBusy(trade),
      isCurrent: (store) =>
        this.current() &&
        store.profile.location.mapId === this.owner.scene.manifest.id,
    });
    this.trade = trade;
    const result = trade.invite();
    if (result.ok) await this.presentTrade(trade);
    else this.owner.ui.status(result.reason);
    this.controls?.refresh();
    return result;
  }

  /** Publish the admitted authority, or release its two-character session on load failure. */
  async presentTrade(trade) {
    try {
      await this.owner.ui.open(
        trade.stores[1] === this.store ? "TradeInvitation" : "TradingRoom",
      );
    } catch (error) {
      await trade.destroy();
      if (this.trade === trade) this.trade = null;
      throw error;
    }
  }

  async selectTradeTarget(targetId) {
    if (!targetId && this.userInfoId !== this.store.id) {
      targetId = this.userInfoId;
    }
    if (targetId) return targetId;
    const name = await this.owner.ui.prompt({
      kind: "text",
      text: "Enter the name of the other loaded local character.",
      maxLength: 13,
    });
    if (name === null) return null;
    return this.social
      .participants()
      .find((record) => record.name.toLowerCase() === name.toLowerCase())?.id;
  }

  tradeParticipantError(actor, peer) {
    if (!actor || !peer || peer === actor) {
      return "Choose two different loaded local characters.";
    }
    if (actor !== this.store && peer !== this.store) {
      return "The active character must participate in this native trade room.";
    }
    if (!peer.profile.settings.gameOptions.allowTrade) {
      return "That character is not accepting trade requests.";
    }
    return null;
  }

  charge(actorId, currency, amount) {
    return this.cashAccountOperation(actorId, "charge", { currency, amount });
  }

  cashGift(actorId, request) {
    return this.cashAccountOperation(actorId, "gift", {
      sn: request?.sn,
      targetId: request?.targetId,
      message: request?.message,
      currency: "prepaid",
    });
  }

  cashReceive(actorId, giftId) {
    return this.cashAccountOperation(actorId, "receive", giftId);
  }

  /** Outside-game producers borrow a loaded account without replacing live owners. */
  async cashAccountOperation(actorId, action, request) {
    if (this.isBusy()) return { ok: false, reason: "The character is busy." };
    const store = this.social.getParticipant(actorId);
    if (!store) {
      return { ok: false, reason: "The local character is not loaded." };
    }
    const service = this.createCash(store);
    this.cashAccountService = service;
    try {
      switch (action) {
        case "charge":
          return await service.charge(request);
        case "gift":
          return await service.gift(request);
        case "receive":
          return await service.claimGift(request);
        default:
          return { ok: false, reason: "Unknown local cash account action." };
      }
    } finally {
      service.destroy();
      this.cashAccountService = null;
      this.controls?.refresh();
    }
  }

  async openCash() {
    if (this.isBusy() || !(await this.owner.ui.requestCloseAll())) return false;
    if (this.cash.closed) {
      const previous = this.cash;
      this.cash = this.createCash();
      this.controllers[this.controllers.indexOf(previous)] = this.cash;
      previous.destroy();
    }
    this.owner.hooks.clearInput();
    this.macros.interrupt("Cash Shop opened");
    await this.owner.enterCashStage();
    try {
      await this.owner.ui.open("CashShop");
    } catch (error) {
      this.owner.leaveCashStage();
      throw error;
    }
    return true;
  }

  windowClosed(name) {
    this.npc.windowClosed(name);
    if (name === "CashShop") this.owner.leaveCashStage();
    this.tradeWindowClosed(name);
    if (
      name === "EnchantSkill" &&
      !this.destroyed &&
      !this.owner.ui.closingAll
    ) {
      this.owner.ui.preloadWindow(name).catch(this.owner.hooks.onError);
    }
    if (name === "PartyHP") {
      this.owner.ui.windows.get("UserList")?.localRefresh?.();
    }
    if (!this.owner.ui.closingAll && !this.destroyed) this.controls?.refresh();
  }

  /** Accepting the notice transfers ownership; every other exit retires the session. */
  tradeWindowClosed(name) {
    if (
      name === "TradingRoom" ||
      (name === "TradeInvitation" && this.trade?.state !== "open")
    ) {
      this.trade?.destroy().catch(this.owner.hooks.onError);
      this.trade = null;
    }
  }

  queueProgress(kind, maxHp) {
    if (!this.store.profile.social.family) return;
    if (this.familyCount === MAX_FAMILY_PROGRESS) {
      this.familyError = new Error(
        "Family progress producer exceeded the bounded pending queue",
      );
      this.owner.hooks.onError(this.familyError);
      return;
    }
    const event =
      this.familyQueue[
        (this.familyHead + this.familyCount) % MAX_FAMILY_PROGRESS
      ];
    event.kind = kind;
    event.maxHp = maxHp;
    this.familyCount++;
  }

  flushDeferred() {
    this.flushTrackerChanges();
    if (
      this.familyCount &&
      !this.familyWork &&
      !this.familyError &&
      !this.isBusy()
    ) {
      this.familyWork = this.flushProgress();
    }
  }

  trackProfileChanges() {
    const profile = this.store.profile;
    if (
      profile.inventory === this.trackerInventory &&
      profile.quests === this.trackerQuests &&
      profile.settings.questTracker === this.trackerSettings &&
      profile.level === this.trackerLevel
    ) {
      return;
    }
    this.trackerInventory = profile.inventory;
    this.trackerQuests = profile.quests;
    this.trackerSettings = profile.settings.questTracker;
    this.trackerLevel = profile.level;
    this.trackerDirty = true;
  }

  flushTrackerChanges() {
    if (this.trackerDirty && !this.trackerWork && !this.isBusy()) {
      this.trackerDirty = false;
      this.trackerWork = this.refreshTracker();
    }
  }

  async refreshTracker() {
    await Promise.resolve();
    try {
      const before = this.store.profile.settings.questTracker.ids.length;
      await this.quests.autoRegister();
      if (!this.current() || this.owner.cashStage) return;
      const tracker = this.store.profile.settings.questTracker;
      if (
        tracker.open &&
        (this.trackerOpen !== true || tracker.ids.length > before)
      ) {
        this.owner.ui.open("QuestAlarm").catch(this.owner.hooks.onError);
      }
      this.trackerOpen = tracker.open;
    } catch (error) {
      this.owner.hooks.onError(error);
    } finally {
      this.trackerWork = null;
      if (this.current()) this.owner.profileChanged();
    }
  }

  async flushProgress() {
    await Promise.resolve();
    try {
      for (
        let count = 0;
        count < MAX_FAMILY_PROGRESS && this.familyCount;
        count++
      ) {
        if (this.isBusy(this.social)) return;
        const result = await this.social.recordProgress(
          this.familyQueue[this.familyHead],
        );
        if (!result.ok) {
          if (result.code === "social-busy") return;
          throw new Error(result.reason);
        }
        this.familyHead = (this.familyHead + 1) % MAX_FAMILY_PROGRESS;
        this.familyCount--;
      }
    } catch (error) {
      this.familyError = error;
      this.owner.hooks.onError(error);
    } finally {
      this.familyWork = null;
    }
  }

  async destroy() {
    if (this.destroyed) return;
    if (this.pending()) {
      throw new Error("Native interface operation is still pending");
    }
    this.destroyed = true;
    this.unsubscribeTracker();
    this.controls?.destroy();
    await this.trade?.destroy();
    await this.chat.destroy();
    this.npc.destroy();
    this.inventory.destroy();
    this.cash.destroy();
    this.book.destroy();
    this.macros.destroy();
    await this.social.destroy();
  }
}
