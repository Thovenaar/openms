import {
  ACTION_PALETTE,
  PHYSICAL_CODES,
  bindingAction,
  heldActionForCode,
  keyIndexForCode,
  isAssignableKey,
} from "./keymap.js";
import { NORMAL_UI_NAMES } from "./game-ui.js";
import {
  saveKeys,
  cancelKeys,
  defaultKeys,
  clearKeys,
} from "./ui-keyconfig.js";
import {
  captureQuickKey,
  refreshQuickSlotConfig,
} from "./ui-quickslot-config.js";
import { CHAT_LIMIT, CHAT_CHANNELS } from "./ui-chat.js";

const PHASES = ["press", "hold", "release"];
const ACTIONS = ["left", "right", "up", "down", "jump", "attack"];
const KEY_OPERATIONS = [
  "open",
  "assign",
  "remove",
  "defaults",
  "clear",
  "quickslot",
  "cancel",
  "save",
];
const QUICK_OPERATIONS = ["open", "assign", "save", "cancel"];
const FIELDS = {
  key: ["type", "code", "phase"],
  action: ["type", "action", "phase"],
  interact: ["type", "id"],
  chat: ["type", "text", "channel"],
  inventory: ["type", "id"],
  ui: ["type", "name"],
};

/**
 * @typedef {{type:'key',code:string,phase:'press'|'hold'|'release'} |
 * {type:'action',action:'left'|'right'|'up'|'down'|'jump'|'attack',phase:'press'|'hold'|'release'} |
 * {type:'interact',id:string} | {type:'chat',text:string,channel?:number|string} |
 * {type:'inventory',id:number} | {type:'ui',name:string} |
 * {type:'keyConfig',operation:string,code?:string,binding?:{type:number,id:number},sourceCode?:string,action?:string,slot?:number}} PlayerCommand
 */

/** Reject unknown fields before interpreting a bounded plain command record. */
function fields(record, allowed) {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    (Object.getPrototypeOf(record) !== Object.prototype &&
      Object.getPrototypeOf(record) !== null)
  ) {
    throw new TypeError("Expected a plain command object");
  }
  const keys = Object.keys(record);
  if (keys.length > 8 || keys.some((key) => !allowed.includes(key))) {
    throw new TypeError("Unknown command field");
  }
}

/** Validate a physical DOM code, not a layout-dependent character or virtual key number. */
function validCode(code) {
  if (!PHYSICAL_CODES.includes(code)) {
    throw new TypeError("Unsupported physical key code");
  }
}

/** Validate the draft command schema without inspecting any live UI or profile. */
function validateKeyCommand(command) {
  if (!KEY_OPERATIONS.includes(command.operation)) {
    throw new TypeError("Unknown keyConfig operation");
  }
  const allowed = ["type", "operation"];
  if (command.operation === "assign") {
    allowed.push("code", "binding", "sourceCode");
  }
  if (command.operation === "remove") allowed.push("code");
  if (command.operation === "quickslot") allowed.push("action", "slot", "code");
  fields(command, allowed);
  if (command.operation === "assign" || command.operation === "remove") {
    validCode(command.code);
  }
  if (command.operation === "assign") validateAssignment(command);
  if (command.operation === "quickslot") validateQuickCommand(command);
}

function validateAssignment(command) {
  fields(command.binding, ["type", "id"]);
  if (
    !Number.isInteger(command.binding.type) ||
    command.binding.type < 1 ||
    command.binding.type > 7 ||
    !Number.isSafeInteger(command.binding.id) ||
    command.binding.id < 0
  ) {
    throw new TypeError("Invalid key binding");
  }
  if (command.sourceCode !== undefined) validCode(command.sourceCode);
}

function validateQuickCommand(command) {
  if (!QUICK_OPERATIONS.includes(command.action)) {
    throw new TypeError("Unknown quickslot action");
  }
  if (command.action === "assign") {
    validCode(command.code);
    if (
      !Number.isInteger(command.slot) ||
      command.slot < 0 ||
      command.slot >= 8
    ) {
      throw new TypeError("Quickslot must be an integer from 0 through 7");
    }
  } else if (Object.hasOwn(command, "slot") || Object.hasOwn(command, "code")) {
    throw new TypeError("Only quickslot assign accepts slot/code");
  }
}

/** Pure, strict recording/dispatch boundary. Returns the original validated command; never mutates it.
 * @param {PlayerCommand} command
 * @returns {PlayerCommand}
 */
export function validatePlayerCommand(command) {
  fields(command, [
    "type",
    "code",
    "phase",
    "action",
    "id",
    "text",
    "channel",
    "name",
    "operation",
    "binding",
    "sourceCode",
    "slot",
  ]);
  if (command.type === "keyConfig") {
    validateKeyCommand(command);
    return command;
  }
  if (!Object.hasOwn(FIELDS, command.type)) {
    throw new TypeError("Unknown player command type");
  }
  fields(command, FIELDS[command.type]);
  validateCommandValue(command);
  return command;
}

function validateCommandValue(command) {
  switch (command.type) {
    case "key":
    case "action":
      validateKeyAction(command);
      return;
    case "interact":
      if (
        typeof command.id !== "string" ||
        !/^life:\d{1,10}$/.test(command.id)
      ) {
        throw new TypeError("Invalid resident NPC id");
      }
      return;
    case "inventory":
      if (!Number.isSafeInteger(command.id) || command.id < 0) {
        throw new TypeError("Invalid inventory item id");
      }
      return;
    case "chat":
      validateChatCommand(command);
      return;
    default:
      if (!NORMAL_UI_NAMES.includes(command.name)) {
        throw new TypeError("Unsupported UI action");
      }
  }
}

function validateKeyAction(command) {
  if (!PHASES.includes(command.phase)) throw new TypeError("Invalid key phase");
  if (command.type === "key") validCode(command.code);
  else if (!ACTIONS.includes(command.action)) {
    throw new TypeError("Unsupported semantic action");
  }
}

function isRelease(command) {
  return (
    (command.type === "key" || command.type === "action") &&
    command.phase === "release"
  );
}

/** Match the edit owner's text and channel bounds without requiring a mounted chat widget. */
function validateChatCommand(command) {
  if (typeof command.text !== "string" || command.text.length > CHAT_LIMIT) {
    throw new TypeError("Invalid chat text length");
  }
  const channel = command.channel;
  const index =
    Number.isInteger(channel) && channel >= 0 && channel < CHAT_CHANNELS.length;
  if (channel !== undefined && !index && !CHAT_CHANNELS.includes(channel)) {
    throw new TypeError("Invalid chat channel");
  }
}

/** A small event-like object is passed to owners directly; it is never dispatched into the DOM. */
function keyEvent(code, target) {
  return {
    code,
    key: keyValue(code),
    target,
    repeat: false,
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    defaultPrevented: false,
    cancelBubble: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.cancelBubble = true;
    },
    stopImmediatePropagation() {
      this.cancelBubble = true;
    },
  };
}

/** Translate only key values consumed by existing owner handlers, not OS text entry. */
function keyValue(code) {
  if (code === "Space") return " ";
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Control")) return "Control";
  if (code.startsWith("Shift")) return "Shift";
  if (code.startsWith("Alt")) return "Alt";
  return code;
}

/** Return explicit normal admission outcomes, never promises of simulated server success. */
function outcome(accepted, reason, extra = {}) {
  return { accepted: Boolean(accepted), reason, ...extra };
}

/** Synchronize cached down edges with the native input owner's explicit clear generation. */
function synchronize(context) {
  if (context.generation === context.input.generation) return;
  context.generation = context.input.generation;
  context.held.fill(0);
  context.semanticCodes.fill(null);
}

/** Resolve semantic actions against the current live draft, with fixed native arrow directions. */
function actionCode(context, systems, command) {
  synchronize(context);
  const index = ACTIONS.indexOf(command.action);
  const previous = context.semanticCodes[index];
  if (previous) return previous;
  const active = systems?.bindings?.active;
  if (!active) return null;
  for (const code of PHYSICAL_CODES) {
    if (heldActionForCode(code, active) === command.action) return code;
  }
  return null;
}

/** Keep browser focus/modal ownership; agent keys do not implement default DOM button/text actions. */
function keyAdmission(ui, target, event) {
  if (!ui.acceptsKey(event)) return "focus-outside-game";
  const modal = ui.modal();
  if (
    modal &&
    modal.name !== "QuickSlotConfig" &&
    event.key !== "Escape" &&
    event.key !== "Tab"
  ) {
    return "modal-blocked";
  }
  if (target !== ui.app.canvas && modal?.name !== "QuickSlotConfig") {
    return focusedKeyAdmission(ui, target, event.key);
  }
  return null;
}

function focusedKeyAdmission(ui, target, key) {
  if (["Escape", "Tab"].includes(key)) return null;
  if (
    target === ui.chat?.input &&
    ["Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)
  ) {
    return null;
  }
  if (target?.matches("input, textarea, select") || target?.isContentEditable) {
    return "focus-blocked; use explicit UI/chat command";
  }
  if (target?.matches("button") && ["Enter", " "].includes(key)) {
    return "browser-default button activation requires explicit UI command";
  }
  return null;
}

/** Deliver down/up through the actual UI/key owners, retaining a press until explicit release. */
function dispatchKey(context, systems, command) {
  synchronize(context);
  const code =
    command.type === "action"
      ? actionCode(context, systems, command)
      : command.code;
  if (!code) return outcome(false, "action-unbound");
  const index = PHYSICAL_CODES.indexOf(code);
  if (command.phase === "release") return releaseKey(context, code);
  if (context.held[index]) return outcome(true, "already-held", { code });
  const ui = systems.ui;
  const target = context.canvas.ownerDocument.activeElement;
  const event = keyEvent(code, target);
  const blocked = keyAdmission(ui, target, event);
  const binding = systems.bindings.lookup(code);
  const previousUse = systems.bindings.items.lastUse;
  ui.onKey(event);
  if (blocked) return outcome(false, blocked);
  if (
    !event.defaultPrevented &&
    !event.cancelBubble &&
    target === context.canvas
  ) {
    context.input.keyDown(event);
  }
  if (!event.defaultPrevented && !event.cancelBubble) {
    return outcome(false, "key-unhandled");
  }
  synchronize(context);
  context.held[index] = 1;
  if (command.type === "action") {
    context.semanticCodes[ACTIONS.indexOf(command.action)] = code;
  }
  return keyResult(systems, event, binding, previousUse);
}

/** Release the physical key originally selected for a semantic hold, including aliases. */
function releaseKey(context, code) {
  context.input.keyUp(keyEvent(code, context.canvas));
  context.held[PHYSICAL_CODES.indexOf(code)] = 0;
  for (let i = 0; i < ACTIONS.length; i++) {
    if (context.semanticCodes[i] === code) context.semanticCodes[i] = null;
  }
  return outcome(true, "released", { code });
}

/** Report normal binding admission without claiming an unsupported original action succeeded. */
function keyResult(systems, event, binding, previousUse) {
  const ui = systems.ui;
  const code = event.code;
  const action = bindingAction(binding);
  const bindingRouted = isBindingKey(ui, event);
  if (bindingRouted && binding?.type === 2) {
    const accepted = systems.bindings.items.lastUse !== previousUse;
    return outcome(accepted, accepted ? "item-used" : "item-use-rejected", {
      code,
      status: ui.lastStatus ?? null,
    });
  }
  if (
    bindingRouted &&
    binding &&
    !heldActionForCode(code, systems.bindings.active) &&
    (!action || !NORMAL_UI_NAMES.includes(action))
  ) {
    return outcome(false, "original-action-unavailable", { code, action });
  }
  return outcome(true, "key-admitted", {
    code,
    action,
    status: ui.lastStatus ?? null,
  });
}

function isBindingKey(ui, event) {
  return (
    event.target === ui.app.canvas &&
    !ui.modal() &&
    !["Enter", "Escape"].includes(event.key)
  );
}

/** Implement named UI controls through their existing owner methods, never arbitrary DOM clicks. */
function dispatchUI(ui, name) {
  if (name === "confirm") {
    return outcome(ui.confirmDialog(), "confirmation-action");
  }
  if (name === "cancel") {
    const modal = ui.modal();
    if (!modal) return outcome(false, "no-modal");
    ui.close(modal.name);
    return outcome(true, "modal-cancelled");
  }
  if (ui.blocksGameplay()) return outcome(false, "modal-blocked");
  if (name === "focusGame") {
    ui.hooks.focusGame();
    return outcome(true, "canvas-focused");
  }
  if (name === "chat") {
    ui.chat.open();
    return outcome(true, "chat-opened");
  }
  if (name === "close") {
    const last = Array.from(ui.windows.keys()).pop();
    if (!last) return outcome(false, "no-window");
    ui.close(last);
    return outcome(true, "close-requested");
  }
  ui.activate(name);
  return outcome(true, "ui-toggle-requested", { name });
}

/** Edit the live draft only through existing binding/confirmation/save owners. */
function dispatchKeyConfig(ui, command, signal) {
  const operation = command.operation;
  if (operation === "quickslot") return dispatchQuickSlot(ui, command);
  if (ui.blocksGameplay()) return outcome(false, "modal-blocked");
  if (operation === "open") {
    return ui.open("KeyConfig").then(() => outcome(true, "keyconfig-opened"));
  }
  const panel = ui.windows.get("KeyConfig");
  const bindings = ui.bindings;
  if (!editableDraft(ui, panel)) {
    return outcome(false, "keyconfig-draft-not-editable");
  }
  if (operation === "save") {
    return saveKeys(panel, signal).then((accepted) =>
      outcome(accepted, accepted ? "keys-saved" : "key-save-failed"),
    );
  }
  if (operation === "cancel") {
    const confirmationRequired = bindings.hasChanges();
    cancelKeys(panel);
    return outcome(true, "keyconfig-cancel-requested", {
      confirmationRequired,
    });
  }
  if (operation === "defaults" || operation === "clear") {
    if (operation === "defaults") defaultKeys(panel);
    else clearKeys(panel);
    return outcome(true, "confirmation-required", {
      confirmationRequired: true,
    });
  }
  return editKeyDraft(bindings, command);
}

function editableDraft(ui, panel) {
  return Boolean(
    panel && ui.bindings?.editing && !ui.bindings.saving && !panel.keySaving,
  );
}

function editKeyDraft(bindings, command) {
  const operation = command.operation;
  const index = keyIndexForCode(command.code);
  const accepted =
    operation === "remove"
      ? bindings.remove(index)
      : bindings.assign(
          index,
          command.binding,
          command.sourceCode === undefined
            ? null
            : keyIndexForCode(command.sourceCode),
        );
  return outcome(
    accepted,
    accepted ? "draft-updated" : "assignment-rejected-or-unchanged",
  );
}

/** Use nested quickslot capture, including its checkpoint, focus groups and native key restrictions. */
function dispatchQuickSlot(ui, command) {
  if (!editableDraft(ui, ui.windows.get("KeyConfig"))) {
    return outcome(false, "keyconfig-draft-not-editable");
  }
  const modal = ui.modal();
  if (command.action === "open") {
    if (ui.blocksGameplay()) return outcome(false, "modal-blocked");
    ui.openQuickSlotCapture();
    return outcome(true, "quickslot-open-requested");
  }
  const panel = ui.windows.get("QuickSlotConfig");
  if (!panel || modal !== panel) {
    return outcome(false, "quickslot-dialog-not-active");
  }
  if (command.action === "save" || command.action === "cancel") {
    ui.close("QuickSlotConfig", command.action === "save");
    return outcome(true, "quickslot-closed", { durable: false });
  }
  return assignQuickSlot(ui, panel, command);
}

function assignQuickSlot(ui, panel, command) {
  if (!isAssignableKey(keyIndexForCode(command.code))) {
    return outcome(false, "quickslot-key-not-assignable");
  }
  const previous = ui.bindings.active.quickSlots[command.slot];
  ui.quickCapture = command.slot;
  panel.captureFooter = null;
  panel.captureControls[command.slot].element.focus();
  const event = keyEvent(
    command.code,
    panel.captureControls[command.slot].element,
  );
  captureQuickKey(ui, event);
  refreshQuickSlotConfig(panel);
  const accepted = previous !== ui.bindings.active.quickSlots[command.slot];
  return outcome(
    accepted,
    accepted ? "quickslot-draft-updated" : "quickslot-rejected-or-unchanged",
  );
}

/** Route non-key commands through their real world/UI/item admission owners. */
function route(context, systems, command, guard) {
  const ui = systems.ui;
  if (command.type === "key" || command.type === "action") {
    return dispatchKey(context, systems, command);
  }
  const target = context.canvas.ownerDocument.activeElement;
  const focusRequest = command.type === "ui" && command.name === "focusGame";
  if (target !== context.canvas && !ui.host.contains(target) && !focusRequest) {
    return outcome(false, "focus-outside-game");
  }
  if (command.type === "ui") return dispatchUI(ui, command.name);
  if (command.type === "keyConfig") {
    return dispatchKeyConfig(ui, command, guard.signal);
  }
  return dispatchGameplay(systems, command, target);
}

function dispatchGameplay(systems, command, target) {
  const ui = systems.ui;
  if (ui.blocksGameplay()) return outcome(false, "modal-blocked");
  if (command.type === "chat") {
    return ui.chat.send(command.text, command.channel);
  }
  if (target?.matches("input,select,textarea") || target?.isContentEditable) {
    return outcome(false, "editing-control-focused");
  }
  if (command.type === "inventory") {
    const accepted = systems.bindings.useItem(command.id);
    return outcome(
      accepted,
      accepted
        ? "item-used"
        : "item-rejected; check ownership, cooldown, death or supported effects",
      { status: ui.lastStatus ?? null },
    );
  }
  const accepted = systems.scene.fieldSystems.life.interactWorld(command.id);
  return outcome(
    accepted,
    accepted
      ? "npc-interaction-admitted"
      : "npc-not-visible-reachable-or-alive",
  );
}

/** Start under a temporary signal scope; only newly initiated asynchronous candidates inherit it. */
function initiate(context, systems, command, guard) {
  const ui = systems.ui;
  const previous = ui.commandSignal;
  ui.commandSignal = guard.signal ?? null;
  try {
    return route(context, systems, command, guard);
  } finally {
    ui.commandSignal = previous;
  }
}

/** Await bounded owner work before returning; revoked pending loads cannot resurrect UI. */
async function settle(ui, result, guard) {
  const pending = Array.from(ui.pending.values(), (task) => task.promise);
  if (ui.quickLoading) pending.push(ui.quickLoading);
  const settled = await Promise.all([result, ...pending]);
  guard.assertActive?.();
  if (guard.signal?.aborted) return outcome(false, "interrupted");
  return settled[0];
}

/** Focus changes during window loading clear gameplay, not this consumed down edge. */
function retainConsumedEdge(context, command, result) {
  synchronize(context);
  if (!result.accepted || !result.code || isRelease(command)) return result;
  context.held[PHYSICAL_CODES.indexOf(result.code)] = 1;
  if (command.type === "action") {
    context.semanticCodes[ACTIONS.indexOf(command.action)] = result.code;
  }
  return result;
}

/**
 * Create the opt-in normal-play adapter. Main supplies the current InGameSystems getter.
 * All commands are normal admission requests; no world/profile mutation privilege is granted.
 * @param {{input:object,getSystems:()=>object,canvas:HTMLCanvasElement}} options
 * @returns {{dispatch:(command:PlayerCommand,guard?:{signal?:AbortSignal,assertActive?:Function})=>Promise<object>,describe:()=>object}}
 */
export function createPlayerActions({ input, getSystems, canvas }) {
  const context = {
    input,
    canvas,
    held: new Uint8Array(PHYSICAL_CODES.length),
    semanticCodes: new Array(ACTIONS.length).fill(null),
    generation: input.generation,
  };
  async function dispatch(command, guard = {}) {
    validatePlayerCommand(command);
    try {
      guard.assertActive?.();
      if (guard.signal?.aborted) return outcome(false, "interrupted");
      const systems = getSystems();
      if (isRelease(command)) {
        return dispatchKey(context, systems, command);
      }
      if (!systemsReady(systems)) {
        return outcome(false, "field-or-ui-not-ready");
      }
      if (systems.ui.pending.size || systems.ui.quickLoading) {
        return outcome(false, "ui-loading");
      }
      const result = initiate(context, systems, command, guard);
      const settled = await settle(systems.ui, result, guard);
      return retainConsumedEdge(context, command, settled);
    } catch (error) {
      return outcome(
        false,
        guard.signal?.aborted ? "interrupted" : "command-rejected",
        { message: error.message },
      );
    }
  }
  function describe() {
    return describeActions(getSystems());
  }
  return { dispatch, describe };
}

function systemsReady(systems) {
  if (!systems?.scene || systems.scene.destroyed || systems.hooks.isBlocked()) {
    return false;
  }
  const ui = systems.ui;
  return Boolean(ui?.visible && !ui.disposed && systems.bindings && ui.index);
}

/** Demand-only discoverability includes the active draft and exact editable source owners. */
function describeActions(systems) {
  return {
    schema: 1,
    commands: {
      key: { code: PHYSICAL_CODES.slice(), phase: PHASES.slice() },
      action: { action: ACTIONS.slice(), phase: PHASES.slice() },
      interact: {
        id: "resident life:N NPC; visible, alive and within existing local reach",
      },
      chat: systems?.ui?.chat?.describe() ?? { maximum: CHAT_LIMIT },
      inventory: { id: "owned numeric item id; ItemUse gates/effects only" },
      ui: {
        name: NORMAL_UI_NAMES.slice(),
        semantics:
          "window names toggle; confirm/cancel address visible modal; focusGame explicitly restores canvas focus",
      },
      keyConfig: describeKeyConfig(),
    },
    bindings: systems?.bindings?.snapshot() ?? null,
    palette: ACTION_PALETTE.map(({ type, id, name }) => ({
      type,
      id,
      name,
      implemented:
        name === "Attack" || name === "Jump" || NORMAL_UI_NAMES.includes(name),
    })),
    semantics:
      "press retains a down edge until release; hold is idempotent; arrows fixed, jump/attack resolve live bindings; native clears invalidate held actions; browser text/button defaults are not synthesized",
    sources: {
      dispatch: "client/src/player-actions.js",
      keys: "client/src/keymap.js",
      input: "client/src/player-input.js",
      bindings: "client/src/key-bindings.js",
      ui: "client/src/game-ui.js",
      chat: "client/src/ui-chat.js",
      inventory: "client/src/item-use.js",
      interaction: "client/src/life-system.js",
      keyConfig: "client/src/ui-keyconfig.js",
      quickslot: "client/src/ui-quickslot-config.js",
    },
  };
}

/** The nested dialog accepts only a draft; durable publication remains an explicit outer Save. */
function describeKeyConfig() {
  return {
    operation: KEY_OPERATIONS.slice(),
    assign: "code,binding:{type,id},sourceCode?",
    remove: "code",
    quickslot: { action: QUICK_OPERATIONS.slice(), assign: "slot:0..7,code" },
    confirmation:
      "defaults/clear/dirty cancel require a separate ui confirm or cancel",
    durability:
      "only explicit keyConfig save persists; quickslot save only accepts nested draft",
  };
}
