import { mountNpcScriptDialogue } from "../npc/npc-script-ui.js";
import { nativeOutcome } from "./native-source.js";

const ANSWERS = Object.freeze({
  next: "next",
  acknowledge: "next",
  previous: "previous",
  close: "cancel",
});

/** Server conversation generations own fetched prose and original UtilDlgEx controls. */
export class NativeDialogue {
  constructor(owner) {
    this.owner = owner;
    this.view = null;
    this.event = null;
    this.generation = 0;
    this.pending = false;
    this.request = null;
    this.selectedOffer = null;
  }
  async publish(event) {
    const generation = ++this.generation;
    this.request?.abort();
    this.request = new AbortController();
    this.event = event;
    this.selectedOffer = null;
    if (event.kind === "quest.offer") this.offerMenu(event);
    else {
      const response = await fetch(`/api/v1/content/${event.contentId}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: this.request.signal,
      });
      if (!response.ok) {
        throw new Error(`Dialogue content HTTP ${response.status}`);
      }
      const content = await response.json();
      if (generation !== this.generation) return;
      if (typeof content.text !== "string" || content.text.length > 65536) {
        throw new Error("Invalid server dialogue prose");
      }
      this.view = this.dialogueView(event, content.text);
    }
    if (generation !== this.generation) return;
    const existing = this.owner.ui.windows.get("UtilDlgEx");
    if (
      existing &&
      this.owner.ui.dialogNpc?.conversationId === event.conversationId
    ) {
      existing.dialogCleanup.refresh();
    } else {
      await this.owner.ui.showNpc({
        templateId: event.npcTemplateId,
        name:
          this.owner.catalog.quests.strings.npc[event.npcTemplateId] ??
          String(event.npcTemplateId),
        conversationId: event.conversationId,
        canInteract: () => this.event?.conversationId === event.conversationId,
      });
    }
  }
  dialogueView(event, text) {
    return {
      ...event.native,
      text,
      sessionId: event.conversationId,
      revision: event.step,
      npcId: event.npcTemplateId,
      choices: event.choices,
      defaultValue: event.native.defaultValue ?? "",
      min: event.minimum,
      max: event.maximum,
      minLength: event.minimum,
      maxLength: event.maximum,
    };
  }
  offerMenu(event) {
    this.view = {
      kind: "choice",
      sessionId: event.conversationId,
      revision: event.step,
      npcId: event.npcTemplateId,
      speaker: 0,
      choices: event.quests.map((entry) => entry.questId),
      text: event.quests
        .map(
          (entry) =>
            `#L${entry.questId}#${this.owner.catalog.quests.records[entry.questId]?.name ?? entry.questId}#l`,
        )
        .join("\r\n"),
    };
  }
  selectOffer(id) {
    const offer = this.event.quests.find((entry) => entry.questId === id);
    if (!offer) {
      return { ok: false, reason: "This quest is no longer offered." };
    }
    this.selectedOffer = offer;
    const record = this.owner.catalog.quests.records[id];
    this.view = {
      ...this.view,
      kind: offer.action === "accept" ? "accept-decline" : "say",
      next: false,
      prev: true,
      text: `${record?.name ?? id}\r\n\r\n${record?.info?.[offer.action === "accept" ? 0 : 1] ?? ""}`,
    };
    return { ok: true };
  }
  async respond(response) {
    const event = this.event;
    if (
      !event ||
      response.sessionId !== event.conversationId ||
      response.revision !== event.step
    ) {
      return { ok: false, reason: "This conversation has changed." };
    }
    if (event.kind === "quest.offer" && response.action === "choose") {
      return this.selectOffer(response.value);
    }
    if (event.kind === "quest.offer" && response.action === "previous") {
      this.selectedOffer = null;
      this.offerMenu(event);
      return { ok: true };
    }
    const action = this.commandFor(response, event);
    this.pending = true;
    try {
      return nativeOutcome(
        await this.owner.command(
          action,
          action.kind === "npc.answer" ? event.step : undefined,
        ),
      );
    } finally {
      this.pending = false;
      this.owner.ui.windows.get("UtilDlgEx")?.dialogCleanup?.refresh();
    }
  }
  commandFor(response, event) {
    if (
      this.selectedOffer &&
      (response.action === "accept" || response.action === "acknowledge")
    ) {
      return {
        kind: `quest.${this.selectedOffer.action}`,
        questId: this.selectedOffer.questId,
        conversationId: event.conversationId,
        step: event.step,
      };
    }
    return {
      kind: "npc.answer",
      conversationId: event.conversationId,
      step: event.step,
      answer: this.answer(response),
    };
  }
  answer(response) {
    if (response.action === "decline") {
      return this.event.kind === "quest.offer"
        ? { kind: "cancel" }
        : { kind: "yesno", value: false };
    }
    if (ANSWERS[response.action]) return { kind: ANSWERS[response.action] };
    if (["yes", "no", "accept"].includes(response.action)) {
      return { kind: "yesno", value: response.action !== "no" };
    }
    if (response.action === "choose") {
      return { kind: "choice", choiceId: response.value };
    }
    if (response.action === "number" || response.action === "text") {
      return { kind: response.action, value: response.value };
    }
    throw new Error("Unsupported native dialogue answer");
  }
  mount(panel) {
    return mountNpcScriptDialogue(panel, this, {
      quests: this.owner.quests,
      name: (id) => this.owner.catalog.quests.strings.npc[id],
      onShop: () => this.owner.ui.open("Shop"),
      onClose: () => this.owner.ui.close("UtilDlgEx", true),
      mountPlayerPortrait: (surface, point) =>
        this.owner.portrait(surface, point),
    });
  }
  close(id) {
    if (this.event?.conversationId !== id) return;
    this.generation++;
    this.request?.abort();
    this.event = null;
    this.view = { kind: "closed" };
    this.owner.ui.close("UtilDlgEx", true);
  }
  destroy() {
    this.generation++;
    this.request?.abort();
    this.event = null;
  }
}
