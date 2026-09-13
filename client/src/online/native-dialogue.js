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
    this.rewardIndex = null;
    this.questConfirmation = null;
  }
  async publish(event) {
    const generation = ++this.generation;
    this.request?.abort();
    this.request = new AbortController();
    this.event = event;
    this.selectedOffer = null;
    this.rewardIndex = null;
    this.questConfirmation = null;
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
    const view = {
      ...event.native,
      text,
      sessionId: event.conversationId,
      revision: event.step,
      npcId: event.npcTemplateId,
      choices: event.choices.map((id) => ({ id })),
      defaultValue: event.native.defaultValue ?? "",
      min: event.minimum,
      max: event.maximum,
      minLength: event.minimum,
      maxLength: event.maximum,
    };
    if (event.quest?.mode !== "confirm") return view;
    this.selectedOffer = {
      questId: event.quest.questId,
      action: event.quest.stage === 0 ? "accept" : "claim",
    };
    this.questConfirmation = view;
    return event.quest.rewardChoices.length ? this.rewardChoiceView() : view;
  }
  rewardChoiceView() {
    const rows = this.event.quest.rewardChoices.map(
      (item) => `#L${item.index}##i${item.id}# #t${item.id}# × ${item.count}#l`,
    );
    return {
      ...this.questConfirmation,
      kind: "choice",
      next: false,
      choices: this.event.quest.rewardChoices.map((item) => ({
        id: item.index,
      })),
      text: `${this.questConfirmation.text}\r\n\r\nSelect one original item reward:\r\n${rows.join("\r\n")}`,
    };
  }
  selectReward(index) {
    const choice = this.event.quest.rewardChoices.find(
      (item) => item.index === index,
    );
    if (!choice) {
      return { ok: false, reason: "This reward is no longer offered." };
    }
    this.rewardIndex = index;
    this.view = {
      ...this.questConfirmation,
      prev: true,
      text: `${this.questConfirmation.text}\r\n\r\n#i${choice.id}# #t${choice.id}# × ${choice.count}`,
    };
    return { ok: true };
  }
  async respond(response) {
    const event = this.event;
    if (
      this.pending ||
      !event ||
      response.sessionId !== event.conversationId ||
      response.revision !== event.step
    ) {
      return { ok: false, reason: "This conversation has changed." };
    }
    const reward = this.rewardResponse(response, event);
    if (reward) return reward;
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
  rewardResponse(response, event) {
    if (event.quest?.mode !== "confirm" || !event.quest.rewardChoices.length) {
      return null;
    }
    if (response.action === "choose") return this.selectReward(response.value);
    if (response.action === "previous" && this.rewardIndex !== null) {
      this.rewardIndex = null;
      this.view = this.rewardChoiceView();
      return { ok: true };
    }
    if (
      this.rewardIndex === null &&
      (response.action === "accept" || response.action === "acknowledge")
    ) {
      return { ok: false, reason: "Select an original item reward." };
    }
    return null;
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
        ...(this.rewardIndex === null
          ? {}
          : { rewardChoice: this.rewardIndex }),
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
      return { kind: "yesno", value: false };
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
