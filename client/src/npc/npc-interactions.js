import { NpcScriptSession } from "./npc-script-runtime.js";
import { NpcShop } from "./npc-shop.js";
import { NpcStorage } from "./npc-storage.js";
import { mountNpcDialogue } from "../ui/quest-ui.js";
import { mountNpcScriptDialogue } from "./npc-script-ui.js";
import { npcTalkLabel } from "./npc-menu.js";

const MAX_ROUTES = 10000;
const MAX_SHOP_ROWS = 200000;

function requireRoute(condition, message) {
  if (!condition) throw new Error(message);
}

function indexRecords(records, key, maximum) {
  requireRoute(
    Array.isArray(records) && records.length <= maximum,
    "NPC reference index exceeds its bound",
  );
  const result = new Map();
  for (const record of records) {
    const id = record?.[key];
    requireRoute(
      Number.isSafeInteger(id) && id > 0 && !result.has(id),
      "Invalid or duplicate NPC reference identity",
    );
    result.set(id, record);
  }
  return result;
}

function normalizedRows(data, shop) {
  requireRoute(
    Array.isArray(shop.itemRows) && shop.itemRows.length <= 8192,
    "Authored shop row bound exceeded",
  );
  return shop.itemRows.map((sourceRow) => {
    requireRoute(
      Number.isSafeInteger(sourceRow) && sourceRow >= 0,
      "Invalid authored shop row reference",
    );
    const row = data.tables.shopitems[sourceRow];
    requireRoute(
      row?.shopid === shop.shopId,
      "Authored shop row belongs to another literal shop",
    );
    return {
      shopId: row.shopid,
      itemId: row.itemid,
      price: row.price,
      pitch: row.pitch,
      position: row.position,
      sourceRow,
    };
  });
}

/** One screen-owned NPC lease; immutable references are fetched through the verified asset owner. */
export class NpcInteractions {
  constructor(owner, store) {
    this.owner = owner;
    this.store = store;
    this.controller = new AbortController();
    this.record = null;
    this.scene = null;
    this.session = null;
    this.shop = null;
    this.storage = null;
    this.loading = false;
    this.destroyed = false;
    this.references = null;
    this.routes = null;
    this.shops = null;
    this.questInventory = null;
  }

  get pending() {
    return (
      this.loading ||
      !!this.session?.pending ||
      !!this.shop?.pending ||
      !!this.storage?.pending
    );
  }

  owns(id) {
    return (
      this.record?.id === id &&
      this.store === this.owner.store &&
      this.scene === this.owner.scene
    );
  }

  isCurrent() {
    return (
      !this.destroyed &&
      this.store === this.owner.store &&
      this.scene === this.owner.scene &&
      this.store.profile?.hp > 0 &&
      this.record?.canInteract?.() === true
    );
  }

  async prepareReferences() {
    if (this.references) return;
    const descriptor = this.owner.catalog.serverData?.datasets?.shops;
    requireRoute(
      descriptor,
      "The authored NPC/server reference package is absent",
    );
    const data = await this.owner.services.network.json(
      descriptor,
      this.controller.signal,
    );
    requireRoute(
      data.schemaVersion === 2 && data.domain === "shops",
      "Unknown authored NPC routing contract",
    );
    requireRoute(
      Array.isArray(data.tables?.shopitems) &&
        data.tables.shopitems.length <= MAX_SHOP_ROWS,
      "Authored SQL shop item table is absent or exceeds its bound",
    );
    requireRoute(
      data.routing?.nameOverride?.operator === "ends-with",
      "Unknown original NPC-name routing policy",
    );
    this.routes = indexRecords(data.npcRoutes, "npcId", MAX_ROUTES);
    this.shops = indexRecords(data.shopIndex, "shopId", MAX_ROUTES);
    this.references = data;
  }

  route() {
    const numeric = this.routes.get(Number(this.record.templateId));
    if (
      numeric &&
      (numeric.precedence === "duey" || numeric.precedence === "gachapon")
    ) {
      return numeric;
    }
    const override = this.references.routing.nameOverride;
    if (this.record.name.endsWith(override.value)) {
      const named = this.references.namedScripts?.[override.script];
      requireRoute(
        named,
        "The original name-selected NPC script is not packaged",
      );
      return named;
    }
    return numeric ?? null;
  }

  async open(record) {
    if (
      this.pending ||
      this.owner.isOperationPending() ||
      record?.canInteract?.() !== true
    ) {
      return false;
    }
    this.release();
    this.record = record;
    this.scene = this.owner.scene;
    this.loading = true;
    try {
      await this.prepareReferences();
      requireRoute(
        this.isCurrent(),
        "The selected NPC no longer owns this field interaction",
      );
      const route = this.route();
      if (this.owner.quests.npcEntries(Number(record.templateId)).length) {
        this.record = {
          ...record,
          onTalk: route ? () => this.startRoute() : null,
          talkLabel: npcTalkLabel(
            record,
            this.owner.quests.catalog.npcScriptLabels,
          ),
        };
        await this.owner.ui.showNpc(this.record);
      } else if (route) await this.runRoute(route);
      else {
        // No authored talk endpoint and no quest entry is an empty interaction, not an error.
        this.owner.ui.close("UtilDlgEx", true);
        this.record = null;
        this.scene = null;
      }
      return true;
    } catch (error) {
      this.owner.ui.status(error.message);
      this.owner.hooks.onError(error);
      return false;
    } finally {
      this.loading = false;
    }
  }

  /** Authored pi.openNpc is a script lease, not a hidden/distant world click. */
  async openPortal(npcId, options) {
    options.signal.throwIfAborted();
    const scene = this.owner.scene;
    requireRoute(
      npcId === 2007 &&
        options.source === "scripts/portal/tutoChatNPC.js" &&
        scene?.manifest.id === options.sourceMapId &&
        this.store === this.owner.store &&
        !this.destroyed,
      "The authored tutorial NPC no longer owns this field",
    );
    // AbstractPlayerInteraction.openNpc returns when a conversation already exists.
    if (this.record) return;
    requireRoute(
      !this.pending && !this.owner.isOperationPending(),
      "The tutorial NPC is blocked by another character operation",
    );
    this.release();
    this.scene = scene;
    this.record = {
      id: `portal-npc:${npcId}`,
      templateId: npcId,
      name: this.owner.catalog.quests.strings.npc[npcId],
      canInteract: () =>
        !options.signal.aborted &&
        this.owner.scene === scene &&
        this.owner.store === this.store,
    };
    this.loading = true;
    try {
      await this.prepareReferences();
      requireRoute(this.isCurrent(), "The tutorial NPC request was cancelled");
      await this.runRoute(this.routes.get(npcId));
      requireRoute(this.isCurrent(), "The tutorial NPC request was cancelled");
    } catch (error) {
      this.loading = false;
      this.release();
      throw error;
    } finally {
      this.loading = false;
    }
  }

  async startRoute() {
    if (this.pending || !this.isCurrent()) {
      return {
        ok: false,
        reason: "This NPC conversation is no longer available.",
      };
    }
    this.loading = true;
    try {
      await this.runRoute(this.route());
      return { ok: true };
    } catch (error) {
      this.owner.ui.status(error.message);
      this.owner.hooks.onError(error);
      return { ok: false, reason: error.message };
    } finally {
      this.loading = false;
    }
  }

  async environment(route) {
    if (
      route.requirements?.includes(
        "quest-state-only-definition:no-timers-no-custom-progress-no-repeat-counters",
      ) &&
      !this.questInventory
    ) {
      this.questInventory = await this.owner.services.network.json(
        this.owner.catalog.quests.inventory,
        this.controller.signal,
      );
    }
    const { catalog } = this.owner;
    const artworkMetadata = catalog.ui.dialogArtwork ?? {};
    const artwork = new Set();
    for (const [path, record] of Object.entries(artworkMetadata)) {
      if (record.descriptor) artwork.add(path);
    }
    return {
      npcId: Number(this.record.templateId),
      items: catalog.ui.items,
      quests: { ...catalog.quests, inventory: this.questInventory },
      names: catalog.quests.strings,
      mapNames: catalog.mapNames,
      portraits: catalog.ui.npcPortraits,
      shops: this.shops,
      artwork,
      artworkMetadata,
      prepareTravel: this.owner.hooks.prepareNpcTravel,
      storageAvailable:
        !!catalog.ui.npcPortraits[this.record.templateId]?.storage &&
        typeof this.store.commitStorage === "function" &&
        !!catalog.ui.bundles.Trunk,
      isCurrent: () => this.isCurrent(),
      isBusy: () =>
        this.owner.isOperationPending(this) ||
        this.owner.hooks.isTransitioning(),
    };
  }

  async runRoute(route) {
    requireRoute(
      route,
      "This NPC has neither an authored numeric script nor a deterministic SQL shop endpoint",
    );
    requireRoute(
      route.status === "supported",
      route.blockers?.[0]?.reason ??
        "The original NPC route requires unavailable authority",
    );
    if (route.precedence === "standard-shop-fallback") {
      return this.openShop({ shopId: route.shopId });
    }
    const session = new NpcScriptSession(
      route,
      this.store,
      await this.environment(route),
    );
    const result = await session.start();
    requireRoute(
      result.ok,
      result.reason ?? "The authored NPC callback was refused",
    );
    this.session = session;
    this.publishOutcome(result);
    if (result.view.kind === "shop") return this.openShop(result.view);
    if (result.view.kind === "storage") return this.openStorage(result.view);
    if (result.view.kind === "closed") this.owner.ui.close("UtilDlgEx", true);
    else await this.owner.ui.showNpc(this.record);
  }

  publishOutcome(result) {
    if (!result.ok) return;
    for (const effect of result.effects) {
      if (effect.kind === "item" && effect.show && effect.delta > 0) {
        this.owner.publishNotice({
          kind: "item",
          itemId: effect.itemId,
          amount: effect.delta,
        });
      }
      if (effect.kind === "meso" && effect.delta > 0) {
        this.owner.publishNotice({ kind: "meso", amount: effect.delta });
      }
    }
    this.owner.profileChanged();
  }

  async shopPrompt(request) {
    const value = await this.owner.ui.prompt({
      ...request,
      value: request.defaultValue,
      owner: this.shop,
    });
    return {
      ok: value !== null && value !== false,
      ...(request.kind === "number" ? { value } : {}),
    };
  }

  async openShop(view) {
    const previous = this.loading;
    this.loading = true;
    try {
      await this.transferToShop(view);
    } finally {
      this.loading = previous;
    }
  }

  async transferToShop(view) {
    const literal = this.shops.get(view.shopId);
    requireRoute(
      literal,
      "The authored literal shop is absent from the authenticated index",
    );
    requireRoute(
      this.isCurrent(),
      "The NPC shop no longer owns its field/profile lease",
    );
    if (this.shop) {
      requireRoute(
        this.shop.destroy().ok,
        "The previous shop is still committing",
      );
    }
    this.shop = new NpcShop(this.store, this.owner.catalog, {
      shopId: view.shopId,
      npc: { id: Number(this.record.templateId), name: this.record.name },
      rows: normalizedRows(this.references, literal),
      isCurrent: () => this.isCurrent(),
      isBusy: () =>
        this.owner.isOperationPending(this) ||
        this.owner.hooks.isTransitioning(),
      prompt: (request) => this.shopPrompt(request),
      onError: this.owner.hooks.onError,
      onTransaction: () => this.owner.profileChanged(),
      onClose: () => this.owner.ui.close("Shop", true),
    });
    this.owner.ui.close("UtilDlgEx", true);
    await this.owner.ui.open("Shop");
  }

  async openStorage(view) {
    requireRoute(
      view.npcId === Number(this.record?.templateId) && this.isCurrent(),
      "The storage NPC no longer owns this field/profile lease",
    );
    const previous = this.loading;
    this.loading = true;
    try {
      this.storage = new NpcStorage(
        this.store,
        this.owner.catalog,
        this.storageContext(view),
      );
      await this.storage.open();
      requireRoute(this.isCurrent(), "The storage interaction has expired");
      this.owner.ui.close("UtilDlgEx", true);
      await this.owner.ui.open("Trunk");
    } catch (error) {
      this.storage?.destroy();
      this.storage = null;
      if (this.isCurrent()) {
        await this.owner.ui.prompt({
          kind: "notice",
          text: error.message,
          owner: this,
        });
      }
      throw error;
    } finally {
      this.loading = previous;
    }
  }

  storageContext(view) {
    return {
      npc: { id: view.npcId, name: this.record.name },
      fees: this.owner.catalog.ui.npcPortraits[view.npcId]?.storage,
      isCurrent: () => this.isCurrent(),
      isBusy: () =>
        this.owner.isOperationPending(this) ||
        this.owner.hooks.isTransitioning(),
      prompt: async (request) => {
        const value = await this.owner.ui.prompt({
          ...request,
          value: request.defaultValue,
          owner: this.storage,
        });
        return { ok: value !== null && value !== false, value };
      },
      onError: this.owner.hooks.onError,
      onTransaction: () => this.owner.profileChanged(),
      onClose: () => this.owner.ui.close("Trunk", true),
    };
  }

  mount(panel, record) {
    if (!this.session || this.session.view.kind === "closed") {
      return mountNpcDialogue(panel, record, this.owner.quests);
    }
    return mountNpcScriptDialogue(panel, this.session, {
      quests: this.owner.quests,
      name: (id) => this.owner.catalog.quests.strings.npc[id],
      onOutcome: (result) => this.publishOutcome(result),
      onShop: (view) => this.openShop(view),
      onStorage: (view) => this.openStorage(view),
      onClose: () => this.owner.ui.close(panel.name, true),
      mountPlayerPortrait: (layer, position) =>
        this.owner.createPortrait(layer, position),
    });
  }

  async showQuestDialogue(dialogue) {
    if (
      this.pending ||
      this.owner.isOperationPending() ||
      this.owner.ui.modal()
    ) {
      return false;
    }
    const store = this.store,
      scene = this.owner.scene;
    const npcId = dialogue.npcId;
    const name = this.owner.catalog.quests.strings.npc[npcId];
    requireRoute(
      name && dialogue.system === this.owner.quests,
      "The original medal quest endpoint is unavailable",
    );
    this.release();
    this.scene = scene;
    this.record = {
      id: `medal-${dialogue.record.id}`,
      templateId: npcId,
      name,
      dialogue,
      mode: "medal-quest",
      canInteract: () =>
        this.store === store &&
        this.owner.scene === scene &&
        store.profile.hp > 0 &&
        !this.owner.hooks.isTransitioning(),
    };
    await this.owner.ui.showNpc(this.record);
    return true;
  }

  windowClosed(name) {
    if (
      !this.loading &&
      (name === "Shop" || name === "Trunk" || name === "UtilDlgEx")
    ) {
      this.release();
    }
  }

  release() {
    if (this.pending) return false;
    if (this.shop && !this.shop.destroy().ok) return false;
    if (this.storage && !this.storage.destroy().ok) return false;
    if (this.session && !this.session.close().ok) return false;
    this.shop = null;
    this.storage = null;
    this.session = null;
    this.record = null;
    this.scene = null;
    return true;
  }

  destroy() {
    if (!this.release()) return false;
    this.destroyed = true;
    this.controller.abort();
    return true;
  }
}
