import { GameUI } from "../ui/game-ui.js";
import { ProfileControls } from "../ui/ui-inspection.js";
import { KeyBindings } from "../input/key-bindings.js";
import { skillPointPool } from "../skills/skill-allocation-rules.js";
import { mountQuestJournal } from "../ui/ui-quest-window.js";
import { QuestReadyNotification } from "../ui/ui-quest-ready-notification.js";
import { NativeAvatarPortrait } from "../ui/ui-avatar-portrait.js";
import { AvatarVisuals } from "../character/avatar-visuals.js";
import { AudiovisualSystem } from "../audio/audiovisual-system.js";
import {
  NativeProfileSource,
  nativeOutcome,
  unsupported,
} from "./native-source.js";
import { NativeInventory } from "./native-inventory.js";
import { NativeQuests } from "./native-quests.js";
import { NativeMacros } from "./native-macros.js";
import { NativeDialogue } from "./native-dialogue.js";
import { NativeShop } from "./native-shop.js";
import { NativeTrade } from "./native-trade.js";
import { NativeEffects } from "./native-effects.js";
import { NativeSkillPresentation } from "./native-skill-presentation.js";
import { animationName } from "../../../shared/motion-schema.js";

const CHAT_BINDINGS = {
  ChatAll: 7,
  ChatWhisper: 6,
  ChatParty: 2,
  ChatBuddy: 0,
  ChatGuild: 3,
  ChatSpouse: 5,
  ChatAlliance: 4,
};
const EMPTY_ENTITIES = Object.freeze([]);
function conversationIdentity(event) {
  return event.conversationId ?? event.shopSession ?? event.tradeId;
}
function interactionKey(event) {
  return `${conversationIdentity(event)}:${event.part ?? ""}`;
}
const CHANNELS = [
  "buddy",
  null,
  "party",
  "guild",
  "alliance",
  "spouse",
  "whisper",
  "map",
];
const UNSUPPORTED_WINDOWS = {
  CashShop: "cash shop",
  Trunk: "storage",
  MonsterBook: "monster book",
  UserList: "social management",
  Messenger: "messenger",
  Family: "family",
  FamilyTree: "family tree",
  Title: "medals",
  PartySearch: "party search",
  PartyHP: "party HP",
  EnchantSkill: "enhancement skills",
  SocialInvitation: "social invitations",
};
const PROFILE_EDITOR_NOTICE =
  "Profile and preset editing requires an authorized GM developer session.";

/** Explain the empty character host instead of leaving an unauthorized section blank. */
function profileEditorNotice() {
  const host = document.querySelector("#inspection-controls");
  if (!host || host.querySelector("[data-developer-only]")) return null;
  const text = document.createElement("p");
  text.className = "hint";
  text.dataset.developerOnly = "";
  text.textContent = PROFILE_EDITOR_NOTICE;
  host.append(text);
  return null;
}

/** Shared native presentation with read-only publication ports and closed server intents. */
export class OnlineUI {
  constructor(app, services, transport, hooks) {
    this.app = app;
    this.services = services;
    this.transport = transport;
    this.hooks = hooks;
    this.state = null;
    this.connection = null;
    this.catalog = null;
    this.pending = 0;
    this.destroyed = false;
    this.store = new NativeProfileSource(this);
    this.audio = new AudiovisualSystem(app, services, {
      onError: (error) => this.report(error),
      onEnabled: () => this.skillVisuals.enableAudio(),
    });
    services.audio = this.audio.audio;
    this.ui = new GameUI(app, services, this.nativeHooks());
    this.ui.setVisible(false);
    this.dialogue = new NativeDialogue(this);
    this.effects = new NativeEffects(this);
    this.skillVisuals = new NativeSkillPresentation(this);
    this.questReady = new QuestReadyNotification(this.ui);
    this.shop = null;
    this.trade = null;
    this.shopPages = new Map();
    this.interactionSignatures = new Map();
  }
  get scene() {
    return this.hooks.scene()?.scene ?? null;
  }
  get entities() {
    return (
      this.transport.model?.entities ?? this.state?.entities ?? EMPTY_ENTITIES
    );
  }
  nativeHooks() {
    return {
      ...this.profileHooks(),
      ...this.interactionHooks(),
      ...this.audioHooks(),
      readOnlyProfile: true,
      clearInput: this.hooks.clearInput,
      keyDown: this.hooks.keyDown,
      inputGeneration: this.hooks.inputGeneration,
      focusGame: this.hooks.focusGame,
      now: () => performance.now(),
      onError: (error) => this.report(error),
      onStatus: (text) => this.hooks.onStatus?.(text),
      onAction: (name) => this.activateBinding(name),
      isOperationPending: () => !this.destroyed && this.pending > 0,
      isFieldBlocked: () => this.blocked(),
      windowCapability: (name) => this.windowCapability(name),
      isWorldInteractive: (x, y) =>
        this.hooks.scene()?.isInteractive?.(x, y) ?? false,
      mapName: (id) => this.catalog?.mapNames[id] ?? null,
    };
  }
  profileHooks() {
    return {
      createProfileControls: (owner) =>
        this.developer() ? new ProfileControls(owner) : profileEditorNotice(),
      onProfileEdit: (patch, options) => this.editProfile(patch, options),
      profileEditSuccess: "Profile edits committed by the server.",
      onLearnSkill: (skillId) =>
        this.request({ kind: "skills.allocate", skillId, amount: 1 }),
      skillAllocationError: (id) => this.skillAllocationError(id),
      skillAllocationPoints: (id) => this.skillPoints(id),
      apAdmission: () => ({
        ok: this.store.profile?.remainingAp > 0 && !this.blocked(),
        reason: "No available AP or active server field.",
      }),
      spendAp: (stat) =>
        this.request({ kind: "stats.allocate", stat, amount: 1 }),
      confirmAp: () =>
        this.ui.prompt({
          kind: "confirm",
          text: "If you invest your AP in HP or MP, your character may have\\r\\ninsufficient stats to become as strong as it could be.\\r\\nDo you still wish to raise this skill?",
        }),
      characterStats: () => this.state?.presentation.stats,
      userInfoProfile: () => this.store.profile,
      userInfoPortrait: (surface, point) => this.portrait(surface, point),
      userInfoFamily: () => unsupported("family management"),
      userInfoParty: () => unsupported("party invitations"),
      userInfoGift: () => unsupported("cash gifts"),
      monsterBook: () => ({ data: this.catalog.ui.monsterBook }),
      petEquipmentUnavailable: () => unsupported("pet equipment").reason,
      onRecover: () => {
        this.ui.showRevival(this.scene).catch((error) => this.report(error));
        return true;
      },
      onRevive: () =>
        this.persist({ kind: "revive.request", method: "return" }),
    };
  }
  interactionHooks() {
    return {
      openLocalTrade: () => this.inviteTrade(),
      inventoryActions: () => this.inventory,
      skillUtilities: () => ({ enhancement: this.inventory }),
      shop: () => this.shop,
      trade: () => this.trade,
      macros: () => this.macros,
      onNpcDialogue: (panel) => this.dialogue.mount(panel),
      onQuestJournal: (panel) => mountQuestJournal(panel, this.quests),
      tradePortrait: (surface, point) => this.portrait(surface, point),
      confirmQuestGiveUp: (id, name) =>
        this.ui.prompt({
          kind: "confirm",
          text: `Do you want to forfeit ${name}?`,
        }),
      markQuestNpc: (id) => this.markQuestNpc(id),
      tradeOutcome: (result) =>
        this.ui.prompt({
          kind: "notice",
          text: result.text ?? result.reason ?? result.code,
        }),
      onDropMesos: (amount) => this.request({ kind: "mesos.drop", amount }),
      onChatSubmit: (text, channel) => this.submitChat(text, channel),
      onChatSettings: (settings) => this.stageChatSettings(settings),
    };
  }
  audioHooks() {
    return {
      playSound: (category, name) =>
        this.audio
          .playSound(category, name)
          .catch((error) => this.report(error)),
      onErrorNotification: () => this.audio.notifyError(),
      getAudioSettings: () => structuredClone(this.audio.audio.settings),
      applyAudioSettings: (settings) => this.applyAudioSettings(settings),
      saveSettings: (settings) =>
        this.persist({ kind: "settings.save", settings }),
    };
  }
  async prepare(catalog, signal) {
    this.catalog = catalog;
    this.avatars = new AvatarVisuals(this.services, catalog);
    await this.audio.prepare(catalog.audiovisual, signal);
    await this.ui.prepare(catalog.ui, signal);
    await this.questReady.prepare(signal);
  }
  prepareProfile() {
    this.inventory = new NativeInventory(this);
    this.quests = new NativeQuests(this);
    this.macros = new NativeMacros(this);
    this.bindings = new KeyBindings(this.store, this.catalog, {
      onAction: (name) => this.activateBinding(name),
      onSkill: (skillId) => this.cast(skillId),
      onSkillRelease: () => this.hooks.clearInput(),
      onSkillCancel: () => this.hooks.clearInput(),
      isBlocked: () => this.blocked() || this.ui.blocksGameplay(),
      now: () => performance.now(),
      report: (text) => this.report(text),
      macros: () => this.macros,
      itemUse: this.inventory,
      saveBindings: (keyBindings) =>
        this.persist({ kind: "key-bindings.save", keyBindings }),
      onSound: (category, name) =>
        this.audio
          .playSound(category, name)
          .catch((error) => this.report(error)),
    });
    this.ui.setProfile(this.store, this.quests);
    this.ui.setBindings(this.bindings);
  }
  async update(snapshot) {
    if (this.destroyed) return;
    if (!snapshot.presentation?.profile) {
      throw new Error("The server did not publish native presentation state.");
    }
    const previous = this.state;
    if (previous && previous.self.entity.id !== snapshot.self.entity.id) {
      this.releaseCharacter();
    }
    this.state = snapshot;
    if (!this.bindings) this.prepareProfile();
    const scene = this.scene;
    if (this.ui.scene !== scene) {
      this.ui.setScene(scene);
      this.audio.setScene(scene);
    }
    this.store.publish();
    this.applySavedPresentation(previous);
    await this.effects.publish(snapshot.self.effects);
    await this.skillVisuals.publish(previous);
    this.questReady.refresh(this.quests);
    await this.reconcileInteractions(snapshot.presentation.interactions);
    this.publishProgressEffects(previous, snapshot);
    await this.openInitialWindows(previous, scene);
  }
  async openInitialWindows(previous, scene) {
    if (this.state.self.hp === 0 && scene) await this.ui.showRevival(scene);
    if (!previous && scene) await this.ui.open("MiniMap");
    if (!previous && this.store.profile.settings.questTracker.open) {
      await this.ui.open("QuestAlarm");
    }
    const visible = this.transport.status === "active";
    if (this.ui.visible !== visible) this.ui.setVisible(visible);
  }
  applySavedPresentation(previous) {
    const settings = this.store.profile.settings;
    if (!this.ui.windows.has("SysOpt")) this.applyAudioSettings(settings);
    const before = previous?.presentation.profile.settings.chat;
    if (
      !before ||
      before.state !== settings.chat.state ||
      before.height !== settings.chat.height
    ) {
      this.ui.chat.applySettings(settings.chat);
    }
  }
  releaseCharacter() {
    clearTimeout(this.chatTimer);
    this.chatDraft = null;
    if (this.dialogue.event) {
      this.dialogue.close(this.dialogue.event.conversationId);
    }
    this.closeShop();
    this.closeTrade();
    this.ui.retireAllWindows();
    this.bindings?.destroy();
    this.macros?.destroy();
    this.bindings = null;
    this.whisperId = null;
    this.interactionSignatures.clear();
  }
  stageChatSettings(settings) {
    if (!this.store.profile || this.destroyed) return;
    this.chatDraft = settings;
    clearTimeout(this.chatTimer);
    this.chatTimer = setTimeout(() => this.flushChatSettings(), 250);
  }
  flushChatSettings() {
    if (!this.chatDraft || this.pending || this.blocked()) return;
    const settings = structuredClone(this.store.profile.settings);
    settings.chat = this.chatDraft;
    this.chatDraft = null;
    this.persist({ kind: "settings.save", settings }).catch((error) =>
      this.report(error),
    );
  }
  publishProgressEffects(previous, current) {
    if (!previous || previous.self.entity.id !== current.self.entity.id) return;
    if (current.self.level > previous.self.level) {
      this.audio
        .playGameplayEffect("LevelUp")
        .catch((error) => this.report(error));
    }
    if (previous.self.hp > 0 && current.self.hp === 0) {
      this.audio.onPlayerDeath();
    }
    for (const quest of current.presentation.quests) {
      if (
        quest.state === 2 &&
        previous.presentation.quests.some(
          (entry) => entry.id === quest.id && entry.state !== 2,
        )
      ) {
        this.audio
          .playGameplayEffect("QuestClear")
          .catch((error) => this.report(error));
        break;
      }
    }
  }
  async reconcileInteractions(events) {
    const ids = new Set(),
      keys = new Set();
    for (const event of events) {
      const id = conversationIdentity(event);
      ids.add(id);
      const key = interactionKey(event);
      keys.add(key);
      const signature = JSON.stringify(event);
      if (this.interactionSignatures.get(key) === signature) continue;
      this.interactionSignatures.set(key, signature);
      await this.event({ event });
    }
    this.retireInteractions(ids);
    for (const key of this.interactionSignatures.keys()) {
      if (!keys.has(key)) this.interactionSignatures.delete(key);
    }
  }
  retireInteractions(ids) {
    if (this.dialogue.event && !ids.has(this.dialogue.event.conversationId)) {
      this.dialogue.close(this.dialogue.event.conversationId);
    }
    if (this.shop && !ids.has(this.shop.event.shopSession)) this.closeShop();
    if (this.trade && !ids.has(this.trade.event.tradeId)) this.closeTrade();
  }
  async command(action, revision) {
    if (this.destroyed) throw new Error("Native online UI was destroyed.");
    this.pending++;
    try {
      const receipt = await this.transport.command(action, revision);
      if (receipt.status !== "committed") {
        this.report(
          receipt.code ?? "Operation outcome unknown; reconnect to recover it.",
        );
      }
      return receipt;
    } finally {
      this.pending--;
      if (!this.pending && this.chatDraft) {
        queueMicrotask(() => this.flushChatSettings());
      }
    }
  }
  async request(action, revision) {
    return nativeOutcome(await this.command(action, revision));
  }
  async persist(action) {
    const result = await this.request(action);
    if (!result.ok) {
      throw Object.assign(new Error(result.reason), { code: result.code });
    }
    return result;
  }
  blocked() {
    return (
      this.destroyed ||
      !this.state ||
      this.transport.status !== "active" ||
      Boolean(this.hooks.isFieldBlocked?.())
    );
  }
  developer() {
    return Boolean(
      this.transport.config?.development &&
      this.transport.config?.role === "developer",
    );
  }
  async editProfile(patch, { jobPreset = null } = {}) {
    if (!this.developer()) {
      throw new Error("Developer profile editing is not authorized.");
    }
    const action =
      jobPreset === null
        ? { kind: "profile", patch }
        : {
            kind: "preset",
            job: jobPreset,
            ...(patch && Object.keys(patch).length ? { patch } : {}),
          };
    const result = await this.transport.develop(action);
    if (result?.status !== "committed") {
      throw new Error(
        result?.code ?? "Developer operation outcome is unknown.",
      );
    }
    return { ok: true, receipt: result };
  }
  portrait(surface, point) {
    const portrait = new NativeAvatarPortrait(surface, this.avatars, point);
    portrait.refresh(point.profile ?? this.store.profile).catch((error) => {
      if (error.name !== "AbortError") this.report(error);
    });
    return portrait;
  }
  skillPoints(id) {
    const pool = skillPointPool(this.catalog.ui.skills[id]?.bookId);
    return this.store.profile?.remainingSp[pool] ?? 0;
  }
  skillAllocationError(id) {
    return this.skillPoints(id) > 0 && !this.blocked()
      ? null
      : "No available SP or active server field.";
  }
  cast(skillId) {
    if (this.blocked()) return false;
    this.command({ kind: "skill.cast", skillId }).catch((error) =>
      this.report(error),
    );
    return true;
  }
  interact(id) {
    if (this.blocked()) return false;
    this.command({ kind: "npc.open", npcId: String(id) }).catch((error) =>
      this.report(error),
    );
    return true;
  }
  nearest(kind) {
    if (!this.state) return null;
    const position =
      this.scene?.presentation ?? this.state.self.entity.position;
    let nearest = null,
      distance = Infinity;
    for (const entity of this.entities) {
      if (entity.kind !== kind) continue;
      const next = Math.hypot(
        entity.position.x - position.x,
        entity.position.y - position.y,
      );
      if (next < distance) {
        distance = next;
        nearest = entity;
      }
    }
    return nearest;
  }
  pickup() {
    const drop = this.nearest("drop");
    if (!drop || this.blocked()) return false;
    this.command({ kind: "drop.pickup", dropId: drop.id }).catch((error) =>
      this.report(error),
    );
    return true;
  }
  activateBinding(name) {
    if (!this.store.profile) return false;
    const input = this.activateInputBinding(name);
    if (input !== null) return input;
    if (name === "MiniMap") return this.ui.advanceMinimap();
    if (name === "Quit") {
      this.quit().catch((error) => this.report(error));
      return true;
    }
    if (name === "QuestAlarm") {
      this.toggleTracker().catch((error) => this.report(error));
      return true;
    }
    const unavailable = this.windowCapability(name);
    if (unavailable) {
      this.report(unavailable);
      return false;
    }
    const opened = this.ui.toggleWindow(name);
    if (!opened) this.report(unsupported(name).reason);
    return opened;
  }
  activateInputBinding(name) {
    if (Object.hasOwn(CHAT_BINDINGS, name)) {
      this.ui.chat.selector.selectedIndex = CHAT_BINDINGS[name];
      this.ui.chat.open();
      return true;
    }
    if (name === "ExpandChat") {
      this.ui.chat.setState(this.ui.chat.state === 3 ? 1 : 3);
      return true;
    }
    if (name === "Talk") return this.talk();
    if (name === "Pickup") return this.pickup();
    if (name !== "Attack" && name !== "Jump") return null;
    this.hooks.tap?.(name === "Attack" ? "attack" : "jump");
    return Boolean(this.hooks.tap);
  }
  talk() {
    return this.hooks.scene()?.life?.talkNearest() ?? false;
  }
  async quit() {
    if (
      await this.ui.prompt({
        kind: "confirm",
        text: "Are you sure you want to quit?",
        owner: this.ui.modal(),
      })
    ) {
      await this.transport.revoke();
    }
  }
  async toggleTracker() {
    const open = !this.ui.windows.has("QuestAlarm");
    const result = await this.quests.changeTracker(open ? "open" : "close");
    if (!result.ok) throw new Error(result.reason);
    if (open) await this.ui.open("QuestAlarm");
    else this.ui.close("QuestAlarm", true);
  }
  windowCapability(name) {
    if (UNSUPPORTED_WINDOWS[name]) {
      return unsupported(UNSUPPORTED_WINDOWS[name]).reason;
    }
    if (
      ["Friends", "Guild", "Party", "Channel", "NPT", "Sit"].includes(name) ||
      name.startsWith("Expression:")
    ) {
      return unsupported(name).reason;
    }
    if (name === "Shop" && !this.shop) {
      return "No server shop conversation is active.";
    }
    if ((name === "TradingRoom" || name === "TradeInvitation") && !this.trade) {
      return "No server trade session is active.";
    }
    return null;
  }
  async submitChat(text, index) {
    const channel = CHANNELS[index];
    if (!channel) {
      return {
        accepted: false,
        reason: "The server does not provide group chat.",
      };
    }
    const action = { kind: "chat.send", channel, text };
    if (channel === "whisper") {
      if (!this.whisperId) {
        this.whisperId = await this.selectPlayer("Whisper to which player?");
      }
      if (!this.whisperId) {
        return { accepted: false, reason: "No whisper recipient selected." };
      }
      action.recipientId = this.whisperId;
    }
    const result = await this.request(action);
    return { accepted: result.ok, reason: result.reason, delivery: "server" };
  }
  async selectPlayer(text) {
    const name = await this.ui.prompt({
      kind: "text",
      text,
      value: "",
      maxLength: 128,
    });
    if (name === null) return null;
    const entity = this.entities.find(
      (entry) =>
        entry.kind === "player" &&
        (entry.id === name || entry.appearance.name === name),
    );
    if (!entity || entity.id === this.store.id) {
      throw new Error("Choose another server-published player in this field.");
    }
    return entity.id;
  }
  async inviteTrade() {
    const targetId = await this.selectPlayer("Trade with which player?");
    if (!targetId) return { ok: false, code: "cancelled" };
    return this.request({ kind: "trade.invite", targetId });
  }
  async markQuestNpc(id) {
    const record = this.catalog.quests.records[id];
    const stage =
      record.stages[Math.min(this.quests.view(id)?.partition ?? 0, 1)];
    const npcId = stage.check.npc || stage.actionCheck.npc;
    const panel = await this.ui.open("WorldMap");
    const result = panel.markNpc(npcId);
    if (!result.ok) {
      throw new Error(
        "The original world map has no location for this quest NPC.",
      );
    }
    return result;
  }
  applyAudioSettings(settings) {
    for (const category of ["BGM", "SE"]) {
      const value = settings[category];
      this.audio.audio.setVolume(category, value.volume, value.mute);
      this.audio.controls.root.querySelector(
        `[data-audio-volume="${category}"]`,
      ).value = value.volume;
      this.audio.controls.root.querySelector(
        `[data-audio-mute="${category}"]`,
      ).checked = value.mute;
    }
    this.audio.refreshVolumeControls();
  }
  async event(message) {
    if (this.destroyed || !message.event) return;
    const event = message.event;
    if (conversationIdentity(event)) {
      this.interactionSignatures.set(
        interactionKey(event),
        JSON.stringify(event),
      );
    }
    if (await this.interactionEvent(event)) return;
    switch (event.kind) {
      case "chat":
        this.ui.chat.receive({
          source: "session",
          text: `${event.senderName}: ${event.text}`,
          time: performance.now(),
        });
        break;
      case "combat":
        await this.skillVisuals.combat(event);
        this.combatAudio(event);
        break;
      case "projectile":
        await this.skillVisuals.projectile(event);
        break;
      case "quest.ready":
        if (this.quests) this.questReady.refresh(this.quests);
        break;
      case "drop.pickup":
        if (event.actorId === this.store.id) {
          await this.audio.playSound("Game", "PickUpItem");
        }
        break;
    }
  }
  async interactionEvent(event) {
    switch (event.kind) {
      case "dialogue":
      case "quest.offer":
        await this.dialogue.publish(event);
        return true;
      case "dialogue.closed":
        this.dialogue.close(event.conversationId);
        if (this.shop?.event.shopSession === event.conversationId) {
          this.closeShop();
        }
        return true;
      case "shop":
        await this.publishShop(event);
        return true;
      case "trade":
        await this.publishTrade(event);
        return true;
      default:
        return false;
    }
  }
  async publishShop(event) {
    if (
      this.shop?.event.shopSession === event.shopSession &&
      this.shop.event.revision === event.revision
    ) {
      return;
    }
    if (!this.shopPages.has(event.shopSession)) this.shopPages.clear();
    if (!this.shopPages.has(event.shopSession)) {
      this.shopPages.set(event.shopSession, new Map());
    }
    const pages = this.shopPages.get(event.shopSession);
    pages.set(event.part, event);
    if (pages.size !== event.parts) return;
    const rows = [];
    for (let part = 0; part < event.parts; part++) {
      const page = pages.get(part);
      if (!page) return;
      rows.push(...page.rows);
    }
    this.shopPages.delete(event.shopSession);
    this.closeShop();
    this.shop = new NativeShop(this, event, rows);
    this.dialogue.close(event.shopSession);
    await this.ui.open("Shop");
  }
  closeShop() {
    this.ui.close("Shop", true);
    this.shop?.destroy();
    this.shop = null;
  }
  async publishTrade(event) {
    if (this.trade?.event.tradeId === event.tradeId) this.trade.update(event);
    else {
      this.closeTrade();
      this.trade = new NativeTrade(this, event);
    }
    if (event.state === "invited" && event.participants[1] === this.store.id) {
      await this.ui.open("TradeInvitation");
    } else if (
      (event.state === "open" || event.state === "confirmed") &&
      !this.ui.windows.has("TradeInvitation")
    ) {
      await this.ui.open("TradingRoom");
    }
  }
  closeTrade() {
    const previous = this.trade;
    this.trade = null;
    this.ui.close("TradeInvitation", true);
    this.ui.close("TradingRoom", true);
    previous?.destroy().catch((error) => this.report(error));
  }
  combatAudio(event) {
    const actor = this.entities.find((entry) => entry.id === event.actorId);
    if (!actor) return;
    if (actor.kind === "mob") {
      this.audio.onMobAttack(
        {
          ...actor.position,
          templateId: actor.templateId,
          action: animationName(actor.action),
        },
        this.scene.presentation,
      );
    } else if (!event.skillId) this.weaponAudio(actor);
    for (const hit of event.hits) {
      const target = this.entities.find((entry) => entry.id === hit.targetId);
      if (target?.kind === "mob" && hit.damage > 0) {
        this.audio.combatSound("Mob", target.templateId, "Damage");
      }
    }
  }
  weaponAudio(actor) {
    const weapon = actor.appearance.equipment.find(
      (entry) => entry.slot === 11,
    );
    const sound =
      this.catalog.ui.avatar.entries[weapon?.templateId]?.combat?.sfx;
    if (sound) this.audio.onPlayerAttack(sound);
  }
  status(value) {
    this.connection = value;
    const visible = value.status === "active" && Boolean(this.store.profile);
    if (this.ui.visible !== visible) this.ui.setVisible(visible);
    if (value.status === "active") this.flushChatSettings();
    if (value.status !== "active") {
      this.bindings?.releaseAllSkills();
      this.hooks.clearInput();
    }
  }
  report(error) {
    const text =
      error instanceof Error
        ? `${error.code ?? "Error"}: ${error.message}`
        : String(error);
    this.ui?.status(text);
    this.hooks.report?.(error);
  }
  resize(width, height) {
    this.ui.resize(width, height);
    this.questReady.resize();
  }
  draw(elapsedMs) {
    this.effects.update();
    this.skillVisuals.update(elapsedMs);
    this.audio.update(elapsedMs);
    this.ui.update(elapsedMs);
    this.questReady.update(elapsedMs);
  }
  destroy() {
    this.destroyed = true;
    clearTimeout(this.chatTimer);
    this.chatDraft = null;
    this.dialogue.destroy();
    this.effects.destroy();
    this.questReady.destroy();
    this.skillVisuals.destroy();
    this.closeShop();
    this.closeTrade();
    this.bindings?.destroy();
    this.macros?.destroy();
    this.store.destroy();
    this.ui.destroy();
    this.audio.destroy();
  }
}
