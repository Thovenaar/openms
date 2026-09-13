import { DialogPortrait } from "./ui-dialog-portrait.js";
import { renderDialogArtwork } from "./ui-dialog-art.js";
import { itemCount } from "../items/inventory-model.js";
import { NativeDialogLayout } from "./ui-dialog-layout.js";
import { NPC_MARKUP_TOKENS as TOKEN } from "../npc/npc-script-markup.js";
import { NPC_MENU_HEADINGS, npcQuestGroup } from "../npc/npc-menu.js";

const MAX_TEXT = 65536;
const PAGE_SIZE = 24;
// 009a2de0/009a16d8: #W selects original Quest/%s banner canvases.
const TEXT_TOKENS = new RegExp(`${TOKEN.source}|#W[^#\\r\\n]+#`, "g");
// 008e4217..4238 toggles the secondary font at #, accepting #c on entry.
const TOOLTIP_TOKENS = /#[bgrdken]|#c|#/g;
// 008f45ba selects font9 for that secondary run; 0098a707 case9 is ARGB ffff9900.
const TOOLTIP_HIGHLIGHT = "#ff9900";
const COLORS = {
  b: "#0000ff",
  r: "#ff0000",
  // CUtilDlgEx 009a356a/009a35e6 uses full-intensity green, not CSS named green.
  g: "#00ff00",
  d: "#000",
  k: "#000",
};

function element(tag, text, className = "") {
  const result = document.createElement(tag);
  result.textContent = text;
  result.className = className;
  return result;
}

function tokenText(token, quests) {
  if (!quests) return token;
  const profile = quests.store.profile;
  if (token.startsWith("#h")) return profile.name;
  const id = Number(token.match(/\d+/)?.[0]);
  const code = token[1];
  if (code === "c") {
    return String(itemCount(profile, id));
  }
  // Original009a1c19..009a1cbe resolves #y through the quest property named by string0x644.
  if (code === "u" || code === "y") {
    return quests.catalog.records[id]?.name ?? token;
  }
  if (code === "a") return monsterProgressText(token, id, quests);
  return catalogTokenText(token, id, quests);
}

function catalogTokenText(token, id, quests) {
  const code = token[1];
  if (code === "m") return quests.mapName(id);
  const table = {
    "@": "npc",
    p: "npc",
    o: "mob",
    t: "item",
    m: "map",
    i: "item",
    v: "item",
    z: "item",
  }[code];
  if (table) return quests.catalog.strings[table][id] ?? token;
  return token;
}

function monsterProgressText(token, id, quests) {
  const profile = quests.store.profile;
  const questId = Math.trunc(id / 10),
    index = (id % 10) - 1;
  const mob = quests.catalog.records[questId]?.stages[1].check.mobs[index];
  return mob
    ? `${profile.quests[questId]?.kills[mob.id] ?? 0}/${mob.count}`
    : token;
}

/** Safe native text spans: unknown NPC tokens stay literal; tooltip # runs select a second font.
 * options={interactive?:boolean,resolver?:(token:string)=>string|null|undefined,color?:string,tooltip?:boolean,dialogue?:boolean}.
 */
export function renderQuestText(container, raw, quests, options = {}) {
  if (typeof raw !== "string" || raw.length > MAX_TEXT) {
    throw new Error("Quest text exceeds rendering policy");
  }
  const text = raw.replace(/\\r\\n|\\n|\\r|\r\n|\r/g, "\n");
  const state = {
    container,
    target: container,
    color: options.color ?? COLORS.k,
    highlight: false,
    bold: false,
    quests,
    interactive: options.interactive ?? false,
    resolver: options.resolver ?? null,
    dialogue: options.dialogue ?? false,
    tooltip: options.tooltip ?? false,
  };
  let position = 0;
  for (const match of text.matchAll(
    options.tooltip ? TOOLTIP_TOKENS : TEXT_TOKENS,
  )) {
    appendStateText(state, text.slice(position, match.index));
    const token = match[0];
    renderMarkupToken(state, token);
    position = match.index + token.length;
  }
  appendStateText(state, text.slice(position));
}

function appendStateText(state, text) {
  appendStyled(
    state.target,
    text,
    state.highlight ? TOOLTIP_HIGHLIGHT : state.color,
    state.bold,
  );
}

function resolvedTokenText(state, token) {
  return state.resolver?.(token) ?? tokenText(token, state.quests);
}

function renderTooltipToken(state, token) {
  if (!state.tooltip || (token !== "#c" && token !== "#")) return false;
  state.highlight = !state.highlight;
  if (token === "#c" && !state.highlight) appendStateText(state, "c");
  return true;
}

function renderMarkupToken(state, token) {
  if (renderTooltipToken(state, token)) return;
  if (token.startsWith("#L")) {
    state.target = choiceElement(token, state.interactive, state.dialogue);
    state.container.append(state.target);
  } else if (token === "#l") state.target = state.container;
  else if (token === "##" || token === "#") return;
  else if (COLORS[token.slice(1)]) state.color = COLORS[token.slice(1)];
  else if (token === "#e" || token === "#n") state.bold = token === "#e";
  else if (/^#[iv]\d+:?#$|^#[fFW]/.test(token)) {
    const image = element("span", resolvedTokenText(state, token));
    image.dataset.questArt = token;
    state.target.append(image);
  } else {
    appendStateText(state, resolvedTokenText(state, token));
  }
}

function choiceElement(token, interactive, dialogue = false) {
  // A real inline link fragments across lines; HTML buttons are atomic inline boxes.
  const target = element(
    interactive ? (dialogue ? "a" : "button") : "span",
    "",
  );
  if (interactive) {
    if (dialogue) {
      target.setAttribute("role", "button");
      target.tabIndex = 0;
    } else target.type = "button";
    target.dataset.questChoice = token.slice(2, -1);
    target.dataset.cursorState = "4";
    target.style.cssText =
      "display:inline;text-align:left;white-space:inherit;overflow-wrap:inherit;max-width:100%;background:transparent;border:0;padding:0;color:inherit;font:inherit;vertical-align:baseline;";
  }
  if (dialogue) {
    // 009a2d95 moves choice runs down10 without adding another paragraph/line.
    target.style.cssText += ";position:relative;top:10px;";
    appendChoiceMarker(target);
  }
  return target;
}

function appendChoiceMarker(target) {
  // 0099e4b2 reserves18px;009a4174/417e draws dot at run+(10,2).
  const spacer = element("span", "");
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.cssText =
    "display:inline-block;position:relative;width:18px;height:12px;vertical-align:baseline;";
  for (let index = 0; index < 2; index++) {
    const marker = element("span", "");
    marker.dataset.choiceMarker = String(index);
    marker.dataset.questArt = `#fUI/UIWindow.img/UtilDlgEx/dot${index}#`;
    marker.style.cssText = `position:absolute;left:10px;top:2px;width:6px;height:7px;visibility:${index ? "hidden" : "visible"};`;
    spacer.append(marker);
  }
  target.append(spacer);
}

function appendStyled(target, text, color, bold) {
  if (!text) return;
  const span = element("span", text);
  span.style.color = color;
  span.style.fontWeight = bold ? "bold" : "normal";
  target.append(span);
}

function hideFooter(controls) {
  for (const control of Object.values(controls)) control.setVisible(false);
}

function showControl(control, action, disabled = false) {
  control.options.action = action;
  control.setDisabled(disabled);
  control.setVisible(true);
}

function renderRewardChoices(container, quests, session) {
  const choices = session?.snapshot().rewardChoices ?? [];
  if (!choices.length) return;
  const select = element("select", "");
  select.dataset.questReward = "true";
  select.setAttribute("aria-label", "Choose one original item reward");
  select.append(new Option("Select original reward", ""));
  for (const item of choices) {
    select.append(
      new Option(
        `${quests.catalog.strings.item[item.id] ?? item.id} × ${item.count}`,
        String(item.index),
      ),
    );
  }
  select.value =
    session.rewardIndex === null ? "" : String(session.rewardIndex);
  container.append(select);
}

function renderMenu(view) {
  const rows = view.quests.npcEntries(view.npcId);
  // 006d3d17..006d3d6b sends talk directly when the quest-ID list is empty.
  // Do not turn an emptied quest menu into a new ETC-only conversation.
  if (!rows.length) {
    if (view.error && view.npc?.onTalk) {
      showControl(view.controls.ok, () => {
        if (admit(view)) void talk(view);
      });
    }
    return;
  }
  rows.sort((a, b) => npcQuestGroup(a) - npcQuestGroup(b));
  const count = Math.ceil(rows.length / PAGE_SIZE);
  view.offset = Math.min(view.offset, Math.max(0, count - 1));
  const end = Math.min(rows.length, (view.offset + 1) * PAGE_SIZE);
  let group = null;
  for (let index = view.offset * PAGE_SIZE; index < end; index++) {
    const entry = rows[index];
    const nextGroup = npcQuestGroup(entry);
    if (nextGroup !== group) {
      group = nextGroup;
      menuHeading(view, NPC_MENU_HEADINGS[group]);
    }
    renderMenuEntry(view, entry.record);
  }
  if (view.npc?.onTalk) {
    menuHeading(view, 2);
    const button = menuButton(view, view.npc.talkLabel);
    button.dataset.npcTalk = "true";
  }
  renderMenuPaging(view, count);
}

function menuHeading(view, index) {
  const labels = [
    "Quest in progress",
    "Quest available",
    "Other dialogue",
    "Quest that can be completed",
  ];
  const heading = element("div", "");
  const image = element("span", labels[index]);
  image.dataset.questArt = `#fUI/UIWindow.img/UtilDlgEx/list${index}#`;
  heading.append(image);
  view.panel.content.append(heading);
}

function menuButton(view, label) {
  const button = element("button", label);
  button.type = "button";
  button.dataset.cursorState = "4";
  button.style.cssText =
    "display:block;text-align:left;width:100%;font:inherit;border:0;background:transparent;padding:0;color:#0000ff;white-space:pre-wrap;overflow-wrap:break-word;";
  view.panel.content.append(button);
  return button;
}

function renderMenuEntry(view, record) {
  menuButton(view, record.name ?? `Quest ${record.id}`).dataset.questId =
    String(record.id);
}

function renderMenuPaging(view, count) {
  if (view.offset > 0) {
    showControl(view.controls.back, () => {
      view.offset--;
      refresh(view);
    });
  }
  if (view.offset + 1 < count) {
    showControl(view.controls.next, () => {
      view.offset++;
      refresh(view);
    });
  }
}

function renderDialogue(view) {
  const state = view.session.snapshot();
  const { content } = view.panel;
  renderQuestText(content, state.text, view.quests, {
    interactive: state.choices.length > 0,
    dialogue: true,
  });
  if (state.mode === "blocked") view.error = state.status.reason;
  renderDialogueControls(view, state);
}

function renderDialogueControls(view, state) {
  const { content } = view.panel;
  if (state.canPrevious) showControl(view.controls.back, () => previous(view));
  if (state.mode === "confirm") {
    renderRewardChoices(content, view.quests, view.session);
    showControl(view.controls.accept, () => accept(view));
    showControl(view.controls.decline, () => {
      view.session.reject();
      refresh(view);
    });
  } else if (state.mode === "offer") {
    if (!state.choices.length) {
      showControl(view.controls.next, () => advance(view));
    }
    // Decline belongs to the actual acceptance question, not every prose page.
  } else if (!state.finalPage) {
    showControl(view.controls.next, () => advance(view));
  } else {
    showControl(view.controls.ok, () => {
      view.session = null;
      refresh(view);
    });
  }
}

/** A retained dialog cannot authorize another field, a dead player or a distant NPC. */
function admit(view) {
  if (view.npc?.canInteract?.() === true) return true;
  view.error =
    "This original NPC is no longer interactable in the current field. Move nearby and reopen the dialogue.";
  refresh(view);
  return false;
}

function previous(view) {
  if (!view.session?.previous()) view.session = null;
  refresh(view);
}

function advance(view, choice = null) {
  if (!admit(view)) return;
  const result = view.session.advance(choice);
  view.error = result.ok ? null : result.reason;
  refresh(view);
}

async function accept(view) {
  if (view.pending || !admit(view)) return;
  view.pending = true;
  view.layout.setPending(true);
  let committed = false;
  try {
    const result = await view.session.accept();
    view.error = result.ok ? null : result.reason;
    committed = result.ok;
    if (!result.ok) view.layout.setError(result.reason);
  } catch (error) {
    view.error = error.message;
    view.layout.setError(error.message);
  } finally {
    view.pending = false;
    view.layout.setPending(false);
    if (committed) refresh(view);
  }
}

function refresh(view) {
  if (view.destroyed || view.pending || view.talkPending) return;
  if (view.session?.snapshot().mode === "closed") view.session = null;
  if (dismissEmptyMenu(view)) return;
  const key = renderKey(view);
  queueDefaultTalk(view);
  if (key === view.renderedKey) {
    view.layout.setError(view.error ?? "");
    return;
  }
  view.renderedKey = key;
  renderPage(view);
}

/** Replace page content only after admission and render-key invalidation. */
function renderPage(view) {
  view.artRequest?.abort();
  view.panel.content.replaceChildren();
  hideFooter(view.controls);
  showSpeaker(view);
  if (view.session) renderDialogue(view);
  else renderMenu(view);
  showControl(view.controls.close, () =>
    view.panel.owner.close(view.panel.name),
  );
  view.kind = dialogueKind(view.session?.snapshot());
  const geometry = view.layout.reflow(view.kind, 0, true);
  view.portrait.setLayout(geometry);
  view.layout.setError(view.error ?? "");
  refreshArtwork(view);
}

/** Defer initial dismissal until GameUI has registered the composed panel and cleanup. */
function dismissEmptyMenu(view) {
  if (
    view.session ||
    view.npc?.onTalk ||
    view.quests.npcEntries(view.npcId).length
  ) {
    return false;
  }
  if (!view.dismissQueued) {
    view.dismissQueued = true;
    queueMicrotask(() => {
      view.dismissQueued = false;
      if (
        view.destroyed ||
        view.panel.owner.windows.get(view.panel.name) !== view.panel
      ) {
        return;
      }
      if (
        !view.session &&
        !view.npc?.onTalk &&
        !view.quests.npcEntries(view.npcId).length
      ) {
        view.panel.owner.close(view.panel.name, true);
      }
    });
  }
  return true;
}

/** Defer the handoff until the composed panel and initial NPC lease are registered. */
function queueDefaultTalk(view) {
  if (
    view.session ||
    !view.npc?.onTalk ||
    view.error ||
    view.defaultTalkTimer !== null ||
    view.quests.npcEntries(view.npcId).length
  ) {
    return;
  }
  view.defaultTalkTimer = setTimeout(() => {
    view.defaultTalkTimer = null;
    if (
      view.destroyed ||
      view.pending ||
      view.talkPending ||
      view.session ||
      view.error ||
      view.panel.owner.windows.get(view.panel.name) !== view.panel ||
      view.quests.npcEntries(view.npcId).length
    ) {
      return;
    }
    if (admit(view)) void talk(view);
  }, 0);
}

/** Profile publication is not a page transition; retain DOM, scroll and artwork leases. */
function renderKey(view) {
  const state = view.session?.snapshot();
  if (!state) {
    return JSON.stringify([
      view.offset,
      view.npc?.talkLabel,
      view.quests
        .npcEntries(view.npcId)
        .map((entry) => [entry.record.id, entry.state, entry.ready]),
    ]);
  }
  const tokens = [];
  for (const match of state.text.matchAll(TEXT_TOKENS)) {
    tokens.push(tokenText(match[0], view.quests));
  }
  return JSON.stringify([
    state.questId,
    state.stage,
    state.mode,
    state.page,
    state.text,
    tokens,
  ]);
}

function showSpeaker(view) {
  if (!view.portrait) return;
  const speakerId = view.session?.say.npc ?? view.npcId;
  view.portrait.show(
    speakerId,
    view.quests.catalog.strings.npc[speakerId] ?? view.npc?.name,
  );
}

function dialogueKind(state) {
  if (!state || state.choices.length) return "choice";
  return state.mode === "confirm" ? "accept-decline" : "say";
}

function refreshArtwork(view) {
  const request = new AbortController();
  view.artRequest = request;
  renderDialogArtwork(view.panel, request.signal)
    .then(() => {
      if (!request.signal.aborted && !view.destroyed) {
        view.portrait.setLayout(view.layout.reflow(view.kind));
      }
    })
    .catch((error) => {
      if (!request.signal.aborted && !view.destroyed) {
        view.panel.owner.report(error);
      }
    });
}

/** Retain the quest menu until its authored route supplies a replacement or a refusal. */
async function talk(view) {
  view.talkPending = true;
  view.layout.setPending(true);
  try {
    const result = await view.npc.onTalk();
    view.error = result.ok ? null : result.reason;
    // A refusal must render native recovery controls even if the quest rows did not change.
    if (!result.ok) view.renderedKey = null;
  } catch (error) {
    view.error = error.message;
    view.renderedKey = null;
    view.panel.owner.report(error);
  } finally {
    view.talkPending = false;
    if (!view.destroyed) {
      view.layout.setPending(false);
      refresh(view);
    }
  }
}

function handleClick(view, event) {
  const button = event.target.closest("[data-quest-choice],button");
  if (!button || !view.panel.content.contains(button)) return;
  if (view.pending || view.talkPending || !admit(view)) return;
  if (button.dataset.npcTalk) {
    void talk(view);
  } else if (button.dataset.questId) {
    view.error = null;
    view.session = view.quests.openDialogue(
      Number(button.dataset.questId),
      view.npcId,
    );
    refresh(view);
  } else if (button.dataset.questChoice !== undefined && view.session) {
    advance(view, Number(button.dataset.questChoice));
  }
}

function mount(panel, quests, npc) {
  const npcId = npc ? Number(npc.templateId) : 0;
  const layout = new NativeDialogLayout(panel);
  const view = {
    panel,
    quests,
    npc,
    npcId,
    offset: 0,
    selected: null,
    session: npc?.dialogue ?? null,
    error: null,
    layout,
    controls: layout.controls,
    pending: false,
    talkPending: false,
    destroyed: false,
    portrait: new DialogPortrait(panel),
    artRequest: null,
    renderedKey: null,
    defaultTalkTimer: null,
  };
  const close = () => {
    if (view.pending || view.talkPending) return false;
    panel.owner.close(panel.name, true);
    return true;
  };
  const click = (event) => handleClick(view, event);
  const change = (event) => {
    if (!view.pending && event.target.dataset.questReward && view.session) {
      view.session.rewardIndex =
        event.target.value === "" ? null : Number(event.target.value);
    }
  };
  panel.content.addEventListener("click", click);
  panel.content.addEventListener("change", change);
  refresh(view);
  const cleanup = () => {
    if (view.pending) return false;
    if (view.destroyed) return true;
    view.destroyed = true;
    clearTimeout(view.defaultTalkTimer);
    view.artRequest?.abort();
    view.portrait?.destroy();
    panel.content.removeEventListener("click", click);
    panel.content.removeEventListener("change", change);
    panel.content.replaceChildren();
    view.layout.destroy();
    return true;
  };
  cleanup.refresh = () => refresh(view);
  // Route replacement may dispose this menu while talk awaits showNpc; user Close
  // is separately refused by requestClose until that handoff has settled.
  cleanup.canClose = () => !view.pending;
  cleanup.requestClose = close;
  return cleanup;
}

/** Main wires this into GameUI hooks.onNpcDialogue after original UtilDlgEx chrome. */
export function mountNpcDialogue(panel, npc, quests) {
  return mount(panel, quests, npc);
}
