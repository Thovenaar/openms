import { Container } from "pixi.js";
import { UISurface } from "../ui/ui-surface.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { NPC_MARKUP_TOKENS } from "../npc/npc-script-markup.js";

const MAX_DIALOGUE_TEXT = 65536;
const MAX_DIALOGUE_CHOICES = 128;
const DIALOGUE_CHOICE = /#L(\d+)#([\s\S]*?)(?:#l|(?=#L\d+#)|$)/g;

/** Authored prose keeps its words and choice labels; presentation markers are not text. */
function dialogueProse(value) {
  const source =
    typeof value === "string" ? value.slice(0, MAX_DIALOGUE_TEXT) : "";
  const labels = new Map();
  const linked = source.replace(DIALOGUE_CHOICE, (match, id, label) => {
    if (labels.size < MAX_DIALOGUE_CHOICES) labels.set(Number(id), label.trim());
    return label;
  });
  return { text: linked.replace(NPC_MARKUP_TOKENS, ""), labels };
}

function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = text;
  parent?.append(node);
  return node;
}
function input(parent, label, type = "text", value = "") {
  const wrapper = element("label", label, parent);
  const node = element("input", null, wrapper);
  node.type = type;
  node.value = value;
  return node;
}
function button(parent, label, callback) {
  const node = element("button", label, parent);
  node.type = "button";
  node.addEventListener("click", callback);
  return node;
}
function group(parent, label) {
  const details = element("details", null, parent);
  element("summary", label, details);
  return element("div", null, details);
}
function select(parent, label, options) {
  const wrapper = element("label", label, parent);
  const node = element("select", null, wrapper);
  for (const [value, text] of options) {
    const option = element("option", text, node);
    option.value = value;
  }
  return node;
}
/** Accessible intent controls and native raster HUD; never owns writable character state. */
export class OnlineUI {
  constructor(app, services, transport, hooks) {
    this.app = app;
    this.services = services;
    this.transport = transport;
    this.hooks = hooks;
    this.root = new Container();
    app.stage.addChild(this.root);
    this.host = document.querySelector("#native-ui");
    this.sidebar = document.querySelector("#controls");
    this.notice = document.querySelector("#notice");
    this.statusNode = document.querySelector("#connection");
    this.state = null;
    this.catalog = null;
    this.panel = null;
    this.development = null;
    this.conversationId = null;
    this.dialogueGeneration = 0;
    this.inventoryNode = group(this.sidebar, "Inventory and equipment");
    this.progressNode = group(this.sidebar, "Skills, quests and attributes");
    this.dialogNode = group(this.sidebar, "NPC conversation and shop");
    this.chatNode = group(this.sidebar, "Chat and trade");
    this.buildLogin();
    this.buildChat();
  }
  async prepare(catalog, signal) {
    this.catalog = catalog;
    const resource = await loadVisualBundle(
      catalog.ui.bundles.StatusBar,
      this.services,
      signal,
    );
    this.panel = new UISurface(this, "StatusBar", resource, [800, 600]);
    this.panel.image("base/backgrnd", 0, 529);
    this.panel.image("base/backgrnd2", 2, 529);
    this.panel.image("gauge/bar", 218, 567);
    this.panel.element.style.pointerEvents = "none";
    this.hud = element(
      "div",
      "Choose a character to enter the world",
      this.host,
    );
    this.hud.className = "online-hud";
    if (import.meta.OPENMS_DEVELOPMENT) this.buildDevelopment();
  }
  buildLogin() {
    const form = document.querySelector("#login");
    const name = input(form, "Account", "text");
    name.autocomplete = "username";
    const password = input(form, "Password", "password");
    password.autocomplete = "current-password";
    const submit = element("button", "Sign in", form);
    submit.type = "submit";
    this.characters = select(form, "Character", []);
    this.characters.hidden = true;
    this.play = button(form, "Enter world", () =>
      this.run(this.transport.connect({ characterId: this.characters.value })),
    );
    this.play.hidden = true;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const characters = await this.transport.login({
          name: name.value,
          password: password.value,
        });
        password.value = "";
        this.characters.replaceChildren();
        for (const character of characters) {
          const option = element(
            "option",
            `${character.name} · Lv.${character.level} · Job ${character.job}`,
            this.characters,
          );
          option.value = character.id;
        }
        this.characters.hidden = false;
        this.play.hidden = false;
        if (!characters.length) {
          this.report(
            "No owned characters. Ask the server operator to provision one.",
          );
        }
      } catch (error) {
        this.report(error);
      } finally {
        submit.disabled = false;
      }
    });
    button(document.querySelector("#session"), "Reconnect", () =>
      this.run(this.transport.reconnect()),
    );
    button(document.querySelector("#session"), "Disconnect", () =>
      this.transport.disconnect(),
    );
  }
  buildChat() {
    this.messages = element("ol", null, this.chatNode);
    this.messages.className = "messages";
    const channel = select(
      this.chatNode,
      "Channel",
      ["map", "whisper", "party", "buddy", "guild", "alliance", "spouse"].map(
        (entry) => [entry, entry],
      ),
    );
    const recipient = input(this.chatNode, "Recipient ID (whisper)");
    const text = input(this.chatNode, "Message");
    text.maxLength = 512;
    button(this.chatNode, "Send", () => {
      const action = {
        kind: "chat.send",
        channel: channel.value,
        text: text.value,
      };
      if (channel.value === "whisper") action.recipientId = recipient.value;
      this.command(action);
      text.value = "";
    });
    const target = input(this.chatNode, "Player ID");
    button(this.chatNode, "Invite to trade", () =>
      this.command({ kind: "trade.invite", targetId: target.value }),
    );
    this.tradeNode = element("div", null, this.chatNode);
  }
  command(action) {
    this.run(this.transport.command(action));
  }
  async run(promise) {
    try {
      const result = await promise;
      if (result?.status || result?.code) {
        this.report(
          `${result.status ?? "Server"}: ${result.code ?? "Outcome unknown; reconnect to recover the original operation"}`,
        );
      }
    } catch (error) {
      this.report(error);
    }
  }
  report(error) {
    this.notice.textContent =
      error instanceof Error
        ? `${error.code ?? "Error"}: ${error.message}`
        : String(error);
  }
  status(value) {
    this.statusNode.textContent = `${value.status}${value.code ? ` · ${value.code}` : ""}`;
    document.querySelector("#login").hidden = value.status === "active";
    if (this.development) {
      this.development.hidden = !(
        this.transport.config?.development &&
        this.transport.config?.role === "developer"
      );
    }
  }
  update(snapshot) {
    this.state = snapshot;
    const self = snapshot.self;
    this.hud.textContent = `${self.entity.appearance.name}   Lv.${self.level}   Job ${self.job}     HP ${self.hp}/${self.maxHp}    MP ${self.mp}/${self.maxMp}    EXP ${self.exp}    Mesos ${snapshot.inventory.mesos}`;
    this.inventoryNode.replaceChildren();
    this.progressNode.replaceChildren();
    this.buildInventory(snapshot.inventory.items);
    this.buildProgress(snapshot);
  }
  buildInventory(items) {
    const amount = input(this.inventoryNode, "Quantity / mesos", "number", "1");
    amount.min = "1";
    const slot = input(
      this.inventoryNode,
      "Destination / equipment slot",
      "number",
      "1",
    );
    slot.min = "0";
    const tab = select(
      this.inventoryNode,
      "Destination tab",
      ["equip", "use", "setup", "etc", "cash"].map((value) => [value, value]),
    );
    button(this.inventoryNode, "Drop mesos", () =>
      this.command({ kind: "mesos.drop", amount: Number(amount.value) }),
    );
    this.itemSelection = select(
      this.inventoryNode,
      "Item",
      items.map((item) => [
        item.id,
        `${this.catalog.ui.items[item.templateId]?.name ?? item.templateId} ×${item.quantity} [${item.location.kind}:${item.location.slot}]`,
      ]),
    );
    this.buildItemActions(items, { amount, slot, tab });
  }
  buildItemActions(items, { amount, slot, tab }) {
    const id = () => this.itemSelection.value;
    button(this.inventoryNode, "Use", () =>
      this.command({ kind: "item.use", itemId: id() }),
    );
    button(this.inventoryNode, "Equip", () =>
      this.command({
        kind: "equipment.equip",
        itemId: id(),
        slot: Number(slot.value),
      }),
    );
    button(this.inventoryNode, "Unequip", () =>
      this.command({
        kind: "equipment.unequip",
        itemId: id(),
        toSlot: Number(slot.value),
      }),
    );
    button(this.inventoryNode, "Move", () =>
      this.command({
        kind: "inventory.move",
        itemId: id(),
        quantity: Number(amount.value),
        to: { tab: tab.value, slot: Number(slot.value) },
      }),
    );
    button(this.inventoryNode, "Drop", () =>
      this.command({
        kind: "item.drop",
        itemId: id(),
        quantity: Number(amount.value),
      }),
    );
    const equipment = select(
      this.inventoryNode,
      "Scroll target",
      items
        .filter((item) => item.equipment)
        .map((item) => [item.id, String(item.templateId)]),
    );
    button(this.inventoryNode, "Apply selected scroll", () =>
      this.command({
        kind: "equipment.scroll",
        scrollId: id(),
        equipmentId: equipment.value,
      }),
    );
  }
  buildProgress(snapshot) {
    const stat = select(
      this.progressNode,
      `AP ${snapshot.self.ap} · Attributes`,
      ["str", "dex", "int", "luk", "hp", "mp"].map((value) => [
        value,
        `${value}: ${snapshot.self.stats[value] ?? snapshot.self[value]}`,
      ]),
    );
    button(this.progressNode, "Allocate 1 AP", () =>
      this.command({ kind: "stats.allocate", stat: stat.value, amount: 1 }),
    );
    const skill = select(
      this.progressNode,
      `SP ${snapshot.self.sp.join(" / ")} · Skills`,
      snapshot.progress.skills.map((value) => [
        value.id,
        `${value.id} · Rank ${value.rank}`,
      ]),
    );
    const learn = input(this.progressNode, "Skill ID to learn", "number");
    button(this.progressNode, "Allocate 1 SP", () =>
      this.command({
        kind: "skills.allocate",
        skillId: Number(learn.value || skill.value),
        amount: 1,
      }),
    );
    button(this.progressNode, "Cast", () =>
      this.command({ kind: "skill.cast", skillId: Number(skill.value) }),
    );
    for (const effect of snapshot.self.effects) {
      if (effect.cancelable) {
        button(this.progressNode, `Cancel buff ${effect.templateId}`, () =>
          this.command({ kind: "buff.cancel", effectId: effect.id }),
        );
      }
    }
    this.buildQuests(snapshot.progress.quests);
    button(this.progressNode, "Return after death", () =>
      this.command({ kind: "revive.request", method: "return" }),
    );
    button(this.progressNode, "Revive with consumable", () =>
      this.command({ kind: "revive.request", method: "consumable" }),
    );
  }
  buildQuests(quests) {
    for (const quest of quests) {
      element(
        "p",
        `Quest ${quest.id} · ${quest.state}${quest.ready ? " · Ready" : ""}`,
        this.progressNode,
      );
      for (const objective of quest.objectives) {
        element(
          "span",
          `${objective.kind} ${objective.templateId}: ${objective.current}/${objective.required} `,
          this.progressNode,
        );
      }
      if (quest.state === "active") {
        button(this.progressNode, "Abandon", () =>
          this.command({ kind: "quest.abandon", questId: quest.id }),
        );
      }
    }
  }
  async event(message) {
    if (message.operationId) {
      this.report(
        `${message.status}: ${message.code ?? "Outcome unknown"} · ${message.operationId}`,
      );
      return;
    }
    const event = message.event;
    if (event.kind === "chat") {
      element("li", `${event.senderId}: ${event.text}`, this.messages);
      if (this.messages.children.length > 100) {
        this.messages.firstChild.remove();
      }
    } else if (event.kind === "dialogue") await this.dialogue(event);
    else if (event.kind === "dialogue.closed") {
      this.closeDialogue(event.conversationId);
    } else if (event.kind === "quest.offer") this.questOffer(event);
    else if (event.kind === "shop") this.shop(event);
    else if (event.kind === "trade") this.trade(event);
    else this.report(`Server: ${event.kind}`);
  }
  observeConversation(id) {
    if (this.conversationId === id) return;
    this.conversationId = id;
    this.dialogNode.parentElement.open = true;
    this.dialogueGeneration++;
    this.dialogNode.replaceChildren();
  }
  closeDialogue(id) {
    if (this.conversationId !== id) return;
    this.conversationId = null;
    this.dialogueGeneration++;
    this.dialogNode.replaceChildren();
    this.dialogNode.parentElement.open = false;
  }
  async dialogue(event) {
    this.observeConversation(event.conversationId);
    const generation = ++this.dialogueGeneration;
    this.dialogNode.replaceChildren();
    const response = await fetch(`/api/v1/content/${event.contentId}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Dialogue content HTTP ${response.status}`);
    }
    const content = await response.json();
    if (
      generation !== this.dialogueGeneration ||
      this.conversationId !== event.conversationId
    ) {
      return;
    }
    const prose = dialogueProse(content.text);
    element("p", prose.text, this.dialogNode);
    const answer = (value) =>
      this.command({
        kind: "npc.answer",
        conversationId: event.conversationId,
        step: event.step,
        answer: value,
      });
    button(this.dialogNode, "Cancel", () => answer({ kind: "cancel" }));
    const kind = event.input;
    if (kind === "next") {
      button(this.dialogNode, "Next", () => answer({ kind }));
    } else if (kind === "yesno") {
      for (const value of [true, false]) {
        button(this.dialogNode, value ? "Yes" : "No", () =>
          answer({ kind, value }),
        );
      }
    } else if (kind === "choice") {
      for (const choice of event.choices) {
        button(this.dialogNode, prose.labels.get(choice) ?? `Choice ${choice}`, () =>
          answer({ kind, choiceId: choice }),
        );
      }
    } else {
      const value = input(this.dialogNode, kind, kind);
      if (kind === "number") {
        value.min = String(event.minimum);
        value.max = String(event.maximum);
      } else value.maxLength = event.maximum;
      button(this.dialogNode, "Answer", () =>
        answer({
          kind,
          value: kind === "number" ? Number(value.value) : value.value,
        }),
      );
    }
  }
  questOffer(event) {
    this.observeConversation(event.conversationId);
    for (const quest of event.quests) {
      const name = this.catalog.quests.records[quest.questId]?.name;
      button(
        this.dialogNode,
        `${quest.action === "accept" ? "Accept" : "Claim"} ${name ?? `quest ${quest.questId}`}`,
        () =>
          this.command({
            kind: `quest.${quest.action}`,
            questId: quest.questId,
            conversationId: event.conversationId,
            step: event.step,
          }),
      );
    }
  }
  shop(event) {
    this.observeConversation(event.shopSession);
    const quantity = input(this.dialogNode, "Shop quantity", "number", "1");
    for (const row of event.rows) {
      button(this.dialogNode, `Buy ${row.templateId} · ${row.unitPrice}`, () =>
        this.command({
          kind: "shop.buy",
          shopSession: event.shopSession,
          rowId: row.rowId,
          quantity: Number(quantity.value),
        }),
      );
    }
    button(this.dialogNode, "Sell selected inventory item", () =>
      this.command({
        kind: "shop.sell",
        shopSession: event.shopSession,
        itemId: this.itemSelection.value,
        quantity: Number(quantity.value),
      }),
    );
    button(this.dialogNode, "Recharge selected item", () =>
      this.command({
        kind: "shop.recharge",
        shopSession: event.shopSession,
        itemId: this.itemSelection.value,
      }),
    );
    button(this.dialogNode, "Close shop", () =>
      this.run(
        this.transport.command(
          {
            kind: "npc.answer",
            conversationId: event.shopSession,
            step: event.revision,
            answer: { kind: "cancel" },
          },
          event.revision,
        ),
      ),
    );
  }
  trade(event) {
    this.tradeNode.replaceChildren();
    element("p", JSON.stringify(event), this.tradeNode);
    if (event.state === "invited") {
      for (const accept of [true, false]) {
        button(this.tradeNode, accept ? "Accept" : "Decline", () =>
          this.command({
            kind: "trade.answer",
            invitationId: event.tradeId,
            accept,
          }),
        );
      }
    } else if (event.state === "open" || event.state === "confirmed") {
      const mesos = input(this.tradeNode, "Offered mesos", "number", "0");
      const quantity = input(
        this.tradeNode,
        "Selected item quantity (0 = none)",
        "number",
        "0",
      );
      button(this.tradeNode, "Replace offer", () =>
        this.command({
          kind: "trade.offer",
          tradeId: event.tradeId,
          mesos: Number(mesos.value),
          items: Number(quantity.value)
            ? [
                {
                  itemId: this.itemSelection.value,
                  quantity: Number(quantity.value),
                },
              ]
            : [],
        }),
      );
      button(this.tradeNode, "Confirm observed offer", () =>
        this.command({ kind: "trade.confirm", tradeId: event.tradeId }),
      );
      button(this.tradeNode, "Cancel trade", () =>
        this.command({ kind: "trade.cancel", tradeId: event.tradeId }),
      );
    }
  }
  buildDevelopment() {
    this.development = group(this.sidebar, "Server development authority");
    this.development.hidden = true;
    const send = (action) => this.run(this.transport.develop(action));
    this.buildMapDevelopment(send);
    this.buildCharacterDevelopment(send);
    this.buildMonsterDevelopment(send);
    this.buildFieldDevelopment(send);
    this.buildInspection();
  }
  buildMapDevelopment(send) {
    const query = input(this.development, "Map search");
    const maps = select(this.development, "Packaged map", []);
    const refresh = () => {
      maps.replaceChildren();
      let count = 0;
      for (const id of Object.keys(this.catalog.maps)) {
        const label = `${id} ${this.catalog.mapNames[Number(id)] ?? ""}`;
        if (!label.toLowerCase().includes(query.value.toLowerCase())) continue;
        if (++count > 100) break;
        const option = element("option", label, maps);
        option.value = id;
      }
    };
    query.addEventListener("input", refresh);
    refresh();
    button(this.development, "Go", () =>
      send({ kind: "map", mapId: Number(maps.value) }),
    );
  }
  buildCharacterDevelopment(send) {
    const job = input(this.development, "Preset job ID", "number", "0");
    button(this.development, "Apply server preset", () =>
      send({ kind: "preset", job: Number(job.value) }),
    );
    const field = select(
      this.development,
      "Character value",
      [
        "level",
        "job",
        "hp",
        "mp",
        "str",
        "dex",
        "int",
        "luk",
        "remainingAp",
        "meso",
      ].map((value) => [value, value]),
    );
    const value = input(this.development, "Value", "number", "1");
    button(this.development, "Request value", () =>
      send({ kind: "profile", patch: { [field.value]: Number(value.value) } }),
    );
  }
  buildMonsterDevelopment(send) {
    const monsters = select(
      this.development,
      "Monster",
      Object.entries(this.catalog.monsters).map(([id, entry]) => [
        id,
        `${id} ${entry.name ?? ""}`,
      ]),
    );
    const count = input(this.development, "Spawn count", "number", "1");
    count.min = "1";
    count.max = "10";
    button(this.development, "Spawn", () =>
      send({
        kind: "spawn",
        templateId: Number(monsters.value),
        count: Number(count.value),
      }),
    );
  }
  buildFieldDevelopment(send) {
    button(this.development, "Pause server field", () =>
      send({ kind: "pause", paused: true }),
    );
    button(this.development, "Resume server field", () =>
      send({ kind: "pause", paused: false }),
    );
    button(this.development, "Step server tick", () =>
      send({ kind: "step", ticks: 1 }),
    );
    const globals = input(
      this.development,
      "Physics globals (JSON)",
      "text",
      "{}",
    );
    const map = input(this.development, "Map physics (JSON)", "text", "{}");
    button(this.development, "Request physics", () => {
      try {
        send({
          kind: "physics",
          globals: JSON.parse(globals.value),
          map: JSON.parse(map.value),
        });
      } catch (error) {
        this.report(error);
      }
    });
  }
  buildInspection() {
    const local = group(this.sidebar, "Local camera and inspection");
    const follow = input(local, "Follow camera", "checkbox");
    follow.checked = true;
    follow.addEventListener("change", () => {
      if (this.hooks.scene()) this.hooks.scene().follow = follow.checked;
    });
    const geometry = input(
      local,
      "Footholds / artwork bounds (inspection snapshot)",
      "checkbox",
    );
    geometry.addEventListener("change", () =>
      this.hooks.scene()?.showGeometry(geometry.checked),
    );
    const x = input(local, "Camera X", "number", "0");
    const y = input(local, "Camera Y", "number", "0");
    button(local, "Pan camera", () => {
      const scene = this.hooks.scene();
      if (
        scene &&
        Number.isFinite(Number(x.value)) &&
        Number.isFinite(Number(y.value))
      ) {
        scene.follow = false;
        follow.checked = false;
        scene.scene.camera.x = Number(x.value);
        scene.scene.camera.y = Number(y.value);
      }
    });
    const output = element("pre", "", local);
    button(local, "Inspect observations", () => {
      output.textContent = JSON.stringify(
        {
          transport: this.transport.snapshot(),
          prediction: this.hooks.prediction.snapshot(),
          self: this.state?.self,
        },
        null,
        2,
      );
    });
  }
  destroy() {
    this.panel?.destroy();
    this.root.destroy({ children: true });
  }
}
