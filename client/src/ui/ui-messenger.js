import { NativeScrollbar } from "./ui-scrollbar.js";
import {
  socialView,
  replaceSocialLayer,
  socialButton,
  socialText,
  requestTarget,
  runSocialAction,
  refreshSocialSelection,
  admitted,
} from "./ui-social-controls.js";

const MODES = [
  {
    background: "backgrnd",
    width: 295,
    height: 364,
    logY: 150,
    logHeight: 154,
    inputY: 318,
  },
  {
    background: "backgrnd2",
    width: 295,
    height: 240,
    logY: 55,
    logHeight: 125,
    inputY: 194,
  },
  { background: "backgrnd3", width: 184, height: 22 },
];
const MAX_MESSAGES = 256;

/** Native008505e2: full/compact/minimized are presentation states of the same three-person session. */
export function layoutMessenger(panel, social) {
  panel.nativeClose = true;
  const state = socialView(panel, social, refreshMessenger);
  state.mode = 0;
  state.builtMode = -1;
  state.draft = "";
  state.followEnd = true;
  panel.requestClose = () =>
    state.view.messenger ? social.execute("messenger.leave") : true;
  state.refresh();
  runSocialAction(state, () =>
    state.view.messenger ? undefined : social.execute("messenger.open"),
  );
}

function buildMessenger(state) {
  const mode = MODES[state.mode];
  if (state.input) state.draft = state.input.value;
  state.input = null;
  state.panel.width = mode.width;
  state.panel.height = mode.height;
  state.panel.element.style.width = `${mode.width}px`;
  state.panel.element.style.height = `${mode.height}px`;
  if (state.panel.dragStrip) {
    state.panel.dragStrip.style.width = `${mode.width - 50}px`;
  }
  replaceSocialLayer(state, `Messenger/${mode.background}`);
  state.memberLayer = null;
  state.builtMode = state.mode;
  const titleY = state.mode === 2 ? 5 : 6;
  socialButton(state, {
    path: "BtClose",
    x: mode.width - 19,
    y: titleY,
    label: "Close messenger",
    action: () => state.panel.owner.close(state.panel.name),
  });
  socialButton(state, {
    path: "BtMin",
    x: mode.width - 47,
    y: titleY,
    label: "Minimize messenger",
    enabled: state.mode < 2,
    action: () => {
      state.mode++;
    },
  });
  socialButton(state, {
    path: "BtMax",
    x: mode.width - 33,
    y: titleY,
    label: "Expand messenger",
    enabled: state.mode > 0,
    action: () => {
      state.mode--;
    },
  });
  if (state.mode === 2) return;
  state.log = state.layer.contentArea(9, mode.logY, 250, mode.logHeight);
  state.log.style.cssText +=
    ";overflow:hidden;white-space:pre-wrap;font:12px Arial,sans-serif;line-height:14px;overflow-wrap:anywhere;";
  state.scrollbar = new NativeScrollbar(
    state.layer,
    { x: 273, y: mode.logY - 2, extent: mode.logHeight, style: 3 },
    (position) => {
      state.log.scrollTop = position * 14;
      state.followEnd = position === state.scrollbar.count - 1;
    },
  );
  buildMessengerInput(state, mode);
}

function buildMessengerInput(state, mode) {
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 256;
  input.value = state.draft;
  input.setAttribute("aria-label", "Messenger message");
  input.style.cssText = `position:absolute;left:9px;top:${mode.inputY}px;width:207px;height:15px;border:0;padding:0;background:transparent;font:12px Arial,sans-serif;line-height:15px;pointer-events:auto;`;
  state.layer.element.append(input);
  state.input = input;
  state.layer.listen(input, "input", () => refreshSocialSelection(state));
  state.layer.listen(input, "keydown", (event) => {
    if (event.isComposing || event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    runSocialAction(state, () => sendMessage(state));
  });
  socialButton(state, {
    path: "Messenger/BtEnter",
    x: 249,
    y: mode.inputY - 1,
    label: "Send messenger message",
    enabled: () =>
      admitted(state, "messenger.send") && Boolean(state.input.value.trim()),
    action: () => sendMessage(state),
  });
}

function refreshMessenger(state) {
  if (state.mode !== state.builtMode) buildMessenger(state);
  refreshSocialSelection(state);
  if (state.mode === 2) return;
  drawMessengerMembers(state);
  const messages = state.view.messenger?.messages || [];
  if (messages.length > MAX_MESSAGES) {
    throw new Error("Messenger message budget exceeded");
  }
  state.log.replaceChildren();
  appendMessage(
    state,
    "[ Maple Messenger Help ]\nInvite : /invite character-name\nEnd : /q",
    "#777777",
  );
  for (const message of messages) {
    appendMessage(state, `${message.senderName} : ${message.text}`, "#333333");
  }
  const count = Math.max(
    1,
    Math.ceil((state.log.scrollHeight - state.log.clientHeight) / 14) + 1,
  );
  state.scrollbar.setRange(
    count,
    state.followEnd ? count - 1 : state.scrollbar.position,
  );
  state.log.scrollTop = state.scrollbar.position * 14;
}

function appendMessage(state, text, color) {
  const node = document.createElement("div");
  node.textContent = text;
  node.style.color = color;
  state.log.append(node);
}

function drawMessengerMembers(state) {
  state.memberLayer?.destroy();
  const layer = state.layer.layer("Messenger members");
  state.memberLayer = layer;
  const members = state.view.messenger?.members || [];
  if (members.length > 3) throw new Error("Native Messenger capacity exceeded");
  for (let index = 0; index < 3; index++) {
    drawMessengerMember(state, layer, members[index], index);
  }
}

function drawMessengerMember(state, layer, member, index) {
  const x = 9 + index * 93;
  const y = state.mode === 0 ? 125 : 29;
  layer.image(`Messenger/NameBar/${member ? index + 1 : 0}`, x, y);
  socialText(
    layer,
    member?.name || "",
    { x: x + 2, y: y + 1, width: 85 },
    { font: "Arial", size: 12 },
  );
  drawMessengerPortrait(state, layer, member, x);
  layer.hit(
    member ? `Messenger participant ${member.name}` : "Invite to messenger",
    {
      x,
      y: state.mode === 0 ? 29 : 26,
      width: 89,
      height: state.mode === 0 ? 112 : 22,
    },
    {
      click: () => {
        if (!member) {
          runSocialAction(state, () =>
            requestTarget(
              state,
              "messenger.invite",
              "Enter the character name to invite.",
            ),
          );
        }
      },
    },
    {
      tooltip: member
        ? `${member.name}\n${member.mapName}`
        : "Invite a character to this conversation.",
    },
  );
}

function drawMessengerPortrait(state, layer, member, x) {
  if (!member || state.mode !== 0) return;
  const portrait = state.panel.owner.hooks.socialPortrait?.({
    layer,
    member,
    x: x + 44,
    y: 119,
  });
  if (portrait) layer.cleanups.push(() => portrait.destroy());
}

async function sendMessage(state) {
  const text = state.input.value.trim();
  if (!text) return { ok: false, code: "cancelled" };
  if (/^\/q$/i.test(text)) return state.panel.owner.close(state.panel.name);
  let outcome;
  const invite = text.match(/^\/invite\s+(.+)$/i);
  if (invite) {
    const target = await state.social.resolveTarget(invite[1]);
    if (state.panel.disposed) return { ok: false, code: "cancelled" };
    if (!target.ok) return target;
    outcome = await state.social.execute("messenger.invite", {
      targetId: target.targetId,
    });
  } else outcome = await state.social.execute("messenger.send", { text });
  if (outcome.ok && !state.panel.disposed) {
    state.input.value = "";
    state.draft = "";
    state.followEnd = true;
  }
  return outcome;
}
