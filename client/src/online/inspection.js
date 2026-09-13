import { createControls } from "../development/scene-controls.js";
import { initializeInspectionTheme } from "../development/inspection-theme.js";
import { AgentControl } from "../development/agent-control.js";
import {
  mountStateTesting,
  inspectionText,
} from "../development/state-testing.js";
import { PROTOCOL } from "../../../shared/protocol.js";
import {
  createOnlineDevelopment,
  mountOnlineExperiments,
} from "./inspection-development.js";

const MAX_RECORDS = 80;
const BADGE_SERVER = "SERVER";
const BADGE_DEVELOPER = "SERVER · GM";
const WORLD_HINT_ONLINE =
  "Inspect scene entities, physics geometry and camera. Previews affect this client only, and world mutations remain server-authorized. The live placement inspector is offline-only.";

/** Shared chrome adapter. Theme/listener ownership begins at prepare and ends at destroy. */
export class OnlineInspection {
  constructor({ transport, prediction, hooks }) {
    this.transport = transport;
    this.prediction = prediction;
    this.hooks = hooks;
    this.controller = new AbortController();
    this.records = [];
    this.model = null;
    this.offer = null;
    this.prepared = false;
    this.dev = createOnlineDevelopment(this);
  }

  prepare() {
    if (this.prepared) return;
    this.prepared = true;
    initializeInspectionTheme(this.controller.signal);
    this.refreshBadge();
    this.qualifyWorldSection();
    this.mountLoginInspection();
    const step = document.querySelector("#step-ms");
    step.min = String(PROTOCOL.TICK_MS);
    step.max = String(PROTOCOL.TICK_MS * 4);
    step.step = String(PROTOCOL.TICK_MS);
    step.value = String(PROTOCOL.TICK_MS);
    const offline = document.querySelector("#offline-inspection");
    if (offline) offline.hidden = true;
    this.controls = createControls(this.controlAPI());
    this.state = mountStateTesting({
      root: document.querySelector("#state-testing-controls"),
      mode: "online",
      read: () => this.read(),
      command: (action) => this.command(action),
      signal: this.controller.signal,
    });
    this.agent = new AgentControl({
      input: this.hooks.input,
      canvas: this.hooks.canvas,
      root: document.querySelector("#agent-controls"),
      hooks: {
        dispatch: (command, lease) => this.dispatch(command, lease),
        observe: () => this.read(),
        capture: () => this.hooks.canvas.toDataURL("image/png"),
        ready: () => this.transport.status === "active",
      },
    });
    this.experiments = mountOnlineExperiments(
      this,
      document.querySelector("#agent-controls"),
    );
    const observe = (event) => this.observeInput(event);
    for (const type of ["keydown", "keyup", "pointerdown", "pointerup"]) {
      this.hooks.canvas.addEventListener(type, observe, {
        signal: this.controller.signal,
      });
    }
  }

  /** Offline keeps LOCAL; online states server authority and GM role when authorized. */
  refreshBadge() {
    document.querySelector(".console-badge").textContent = this.authorized()
      ? BADGE_DEVELOPER
      : BADGE_SERVER;
  }

  /** The live placement inspector reads local placement metadata, so online states its absence. */
  qualifyWorldSection() {
    const life = document.querySelector("#life-inspection");
    if (life) life.hidden = true;
    const hint = document.querySelector("#console-world-hint");
    if (hint) hint.textContent = WORLD_HINT_ONLINE;
  }

  /** Login controls are presentation-only and require no gameplay authority. */
  mountLoginInspection() {
    const root = document.createElement("details");
    root.id = "login-inspection";
    root.open = true;
    const title = document.createElement("summary");
    title.textContent = "Login scene · animation and transitions";
    this.loginReadout = document.createElement("pre");
    this.loginReadout.className = "hint";
    this.loginReadout.setAttribute("aria-label", "Login presentation state");
    this.loginButtons = [];
    const actions = document.createElement("div");
    actions.className = "button-row";
    for (const [text, action] of [
      ["Pause animation", "pause"],
      ["Step 30 ms", "step"],
      ["Replay transition", "replay"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.dataset.loginAction = action;
      button.addEventListener("click", () => this.loginAction(action), {
        signal: this.controller.signal,
      });
      actions.append(button);
      this.loginButtons.push(button);
    }
    root.append(title, actions);
    const login = this.hooks.login();
    this.loginUtilities = document.createElement("div");
    this.loginUtilities.className = "button-row";
    for (const button of [login.refreshButton, login.signOutButton]) {
      button.classList.remove("online-login-button");
      this.loginUtilities.append(button);
    }
    root.append(this.loginUtilities, this.loginReadout);
    document.querySelector("#console-world-hint").after(root);
    this.loginInspection = root;
    this.refreshLoginInspection();
  }

  loginAction(action) {
    const login = this.hooks.login();
    if (!login?.visible) return;
    if (action === "pause") {
      login.presentationPaused = !login.presentationPaused;
    } else if (action === "step") login.stepPresentation(PROTOCOL.TICK_MS);
    else if (action === "replay") login.backdrop?.replayTransition();
    this.refreshLoginInspection();
  }

  refreshLoginInspection() {
    const login = this.hooks.login();
    const state = login?.snapshot();
    this.loginInspection.hidden = !state?.visible;
    if (!state?.visible) return;
    this.loginUtilities.hidden = state.stage !== "characters";
    this.loginReadout.textContent = inspectionText(state);
    this.loginButtons[0].textContent = state.paused
      ? "Resume animation"
      : "Pause animation";
    this.loginButtons[0].setAttribute("aria-pressed", String(state.paused));
    this.loginButtons[1].disabled = !state.paused || !state.artwork;
    this.loginButtons[2].disabled = !state.transition?.replayable;
  }

  authorized() {
    return (
      this.transport.config?.development === true &&
      this.transport.config?.role === "developer"
    );
  }

  /** Canvas input only: never record login fields, chat text or inspection drafts. */
  observeInput(event) {
    if (!event.isTrusted || event.repeat) return;
    this.record("native input", {
      type: event.type,
      code: event.code,
      button: event.button,
      defaultPrevented: event.defaultPrevented,
    });
  }

  controlSnapshot() {
    const snapshot = this.hooks.snapshot();
    const available = this.authorized() && this.transport.status === "active";
    const reason = available
      ? "Audited development HTTP request; server validates field ownership."
      : "Server authority: developer session required; player/production mutations refused.";
    return {
      ...snapshot,
      developmentControls: { available, reason },
      developmentSpawn: { available, reason },
    };
  }

  controlAPI() {
    return {
      ...this.hooks.api,
      snapshot: () => this.controlSnapshot(),
      onError: (error) => this.report(error),
      pause: (paused) => this.develop({ kind: "pause", paused }),
      step: (ms) => this.step(ms),
      switchMap: (mapId) => this.develop({ kind: "map", mapId: Number(mapId) }),
      reload: () =>
        this.develop({ kind: "map", mapId: Number(this.model.field.mapId) }),
      spawnMonster: async (templateId) => {
        const result = await this.develop({
          kind: "spawn",
          templateId,
          count: 1,
        });
        return { ok: result.status === "committed", reason: result.code };
      },
    };
  }

  step(ms) {
    const ticks = ms / PROTOCOL.TICK_MS;
    if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 4) {
      throw new Error(
        `Server step requires 1–4 ticks of ${PROTOCOL.TICK_MS} ms.`,
      );
    }
    return this.develop({ kind: "step", ticks });
  }

  async develop(action) {
    if (!this.authorized()) {
      throw new Error(
        "Developer session required; no local mutation performed.",
      );
    }
    this.record("development request", action);
    const result = await this.transport.develop(action);
    this.record("development result", result);
    if (result.status !== "committed") {
      throw new Error(result.code || result.status);
    }
    return result;
  }

  async dispatch(command, lease) {
    lease.assertActive();
    this.record("normal input command", command);
    try {
      const result = await this.hooks.dispatch(command, lease);
      this.record("normal input result", result);
      return result;
    } catch (error) {
      this.report(error);
      throw error;
    }
  }

  async command(action) {
    this.record("inspection request", action);
    if (action.kind === "inspection.resync") {
      this.transport.resync("gap");
      return {
        status: this.transport.status,
        requested: "authoritative resync",
      };
    }
    if (action.kind === "inspection.reconnect") {
      return this.transport.reconnect();
    }
    return this.questCommand(action);
  }

  async questCommand(action) {
    const systems = this.hooks.systems();
    if (action.kind === "inspection.quest-journal") {
      await systems.ui.open("Quest");
      return { status: "opened", window: "Quest" };
    }
    if (action.kind === "inspection.quest-abandon") {
      const quest = systems.quests;
      if (!quest.giveUpAdmission(action.questId).ok) {
        throw new Error("Quest cannot be abandoned.");
      }
      const confirmed = await systems.ui.hooks.confirmQuestGiveUp(
        action.questId,
        quest.catalog.records[action.questId].name,
      );
      if (!confirmed) return { status: "cancelled" };
      return quest.giveUp(action.questId, true);
    }
    const result = await systems.command(this.offeredQuestAction(action));
    this.record("quest result", result);
    return result;
  }

  offeredQuestAction(action) {
    const kind =
      action.kind === "inspection.quest-accept"
        ? "accept"
        : action.kind === "inspection.quest-claim"
          ? "claim"
          : null;
    const offer = this.requireQuestOffer(action, kind);
    const dialogue = this.hooks.systems().dialogue;
    if (
      dialogue.event?.conversationId !== offer.conversationId ||
      dialogue.event?.step !== offer.step
    )
      {throw new Error("The native quest conversation has changed.");}
    return dialogue.commandFor(
      { action: kind === "accept" ? "accept" : "acknowledge" },
      offer,
    );
  }

  requireQuestOffer(action, kind) {
    const offer = this.offer;
    if (
      !kind ||
      !offer ||
      offer.conversationId !== action.conversationId ||
      offer.step !== action.step ||
      offer.quest?.mode !== "confirm" ||
      offer.quest.questId !== action.questId ||
      offer.quest.stage !== (kind === "accept" ? 0 : 1)
    ) {
      throw new Error("A current server NPC quest offer is required.");
    }
    return offer;
  }

  questEntries() {
    const entries = this.model?.presentation?.quests ?? [];
    const catalog = this.hooks.catalog()?.quests;
    return entries.map((entry) => ({
      ...entry,
      name: catalog?.records?.[entry.id]?.name,
    }));
  }

  read() {
    const model = this.model;
    return {
      quests: this.questSnapshot(),
      connection: this.transport.snapshot(),
      content: {
        assetBuildId: this.transport.config?.assetBuildId,
        rulesHash: this.transport.config?.rulesHash,
        catalogHash: this.transport.config?.catalogHash,
        field: model?.field,
      },
      prediction: this.prediction.snapshot(),
      operations: this.records,
      peers: {
        self: model?.self,
        entities: model?.entities,
        characterId: this.transport.characterId,
        connectionEpoch: this.transport.connectionEpoch,
      },
    };
  }
  questSnapshot() {
    const model = this.model;
    return {
      entries: this.questEntries(),
      progress: model?.progress?.quests,
      presentation: model?.presentation?.quests,
      offer: this.offer,
      interactions: model?.presentation?.interactions,
    };
  }

  update(snapshot) {
    this.refreshLoginInspection();
    if (!snapshot) {
      this.model = null;
      this.offer = null;
      this.controls?.refresh(this.controlSnapshot());
      this.state?.refresh();
      this.refreshBadge();
      return;
    }
    if (snapshot.presentation !== this.model?.presentation) {
      this.offer =
        snapshot.presentation?.interactions?.find(
          (event) =>
            event.kind === "dialogue" && event.quest?.mode === "confirm",
        ) ?? null;
    }
    this.model = snapshot;
    if (!this.prepared) return;
    this.controls.refresh(this.controlSnapshot());
    this.state.refresh();
    this.experiments.refresh();
    this.refreshBadge();
  }

  event(message) {
    const event = message.event ?? message;
    if (event.kind === "dialogue")
      {this.offer = event.quest?.mode === "confirm" ? event : null;}
    if (event.kind === "dialogue.closed") this.offer = null;
    this.record("server event", message);
  }

  status(value) {
    if (value.status !== "active") this.offer = null;
    this.record("connection", value);
    this.experiments?.refresh();
  }

  record(kind, value) {
    if (this.records.length === MAX_RECORDS) this.records.shift();
    this.records.push({ kind, value: inspectionText(value) });
    this.state?.refresh();
  }

  report(error) {
    this.hooks.report(error);
  }

  destroy() {
    this.controller.abort();
    this.loginInspection?.remove();
    this.controls?.destroy();
    this.agent?.destroy();
    this.state?.destroy();
    this.experiments?.destroy();
    this.records.length = 0;
  }
}
