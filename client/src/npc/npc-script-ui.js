import { renderQuestText } from "../ui/quest-ui.js";
import { renderDialogArtwork } from "../ui/ui-dialog-art.js";
import { DialogPortrait } from "../ui/ui-dialog-portrait.js";
import { NativeDialogLayout } from "../ui/ui-dialog-layout.js";

const KINDS = new Set([
  "say",
  "yes-no",
  "accept-decline",
  "choice",
  "number",
  "text",
]);

function busy(view) {
  return view.responding || view.session.pending;
}

function nativeName(view, id) {
  return (
    view.context.name?.(id) ?? view.context.quests?.catalog.strings.npc[id]
  );
}

function setPending(view) {
  view.layout.setPending(busy(view));
  if (view.context.onCancel) view.layout.controls.close.setDisabled(false);
  const next = view.layout.controls.next;
  if (view.displayed?.kind === "choice") {
    next.setDisabled(busy(view) || view.selected === null);
  }
}

function setControls(view, current) {
  const layout = view.layout;
  layout.hideControls();
  if (view.context.onCancel || !(current.speaker & 1)) {
    layout.show("close", () => respond(view, "close"));
  }
  if (current.kind === "say") {
    if (current.prev) layout.show("back", () => respond(view, "previous"));
    if (current.next) layout.show("next", () => respond(view, "next"));
    else layout.show("ok", () => respond(view, "acknowledge"));
  } else if (current.kind === "yes-no") {
    layout.show("yes", () => respond(view, "yes"));
    layout.show("no", () => respond(view, "no"));
  } else if (current.kind === "accept-decline") {
    layout.show("accept", () => respond(view, "accept"));
    layout.show("decline", () => respond(view, "decline"));
  } else if (current.kind === "choice") {
    layout.show("next", () => submit(view), view.selected === null);
  } else layout.show("ok", () => submit(view));
}

function makeInput(view, current) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = String(current.defaultValue);
  input.autocomplete = "off";
  input.spellcheck = false;
  input.dataset.cursorState = "0";
  input.setAttribute(
    "aria-label",
    current.kind === "number" ? "Number" : "Text",
  );
  input.style.cssText =
    "position:absolute;box-sizing:border-box;font:12px/14px Arial,sans-serif;color:#000;background:#fff;border:1px solid #000;border-radius:0;padding:2px;pointer-events:auto;";
  if (current.kind === "number") {
    input.inputMode = "numeric";
    input.setAttribute("aria-valuemin", String(current.min));
    input.setAttribute("aria-valuemax", String(current.max));
  } else {
    input.minLength = current.minLength;
    input.maxLength = current.maxLength;
  }
  view.layout.layer.element.append(input);
  view.input = input;
  view.layout.input = input;
}

function placeInput(view, geometry) {
  if (!view.input) return;
  // 009a83f6: border=(textX-1,textY+textHeight+2,W-2*textX+3,18).
  view.input.style.left = `${geometry.x - 1}px`;
  view.input.style.top = `${geometry.y + Math.min(geometry.measured, geometry.body) + 2}px`;
  view.input.style.width = `${geometry.width - geometry.x * 2 + 3}px`;
  view.input.style.height = "18px";
}

function layoutPortrait(view, current, geometry) {
  if (!(current.speaker & 2)) {
    releasePlayer(view);
    view.portrait.show(current.npcId, nativeName(view, current.npcId));
    view.portrait.setLayout(geometry);
    return;
  }
  view.portrait.hide();
  if (view.playerPortrait?.bounds) {
    placePlayer(view, geometry);
    return;
  }
  if (view.playerLoading) return;
  if (typeof view.context.mountPlayerPortrait !== "function") {
    throw new Error("Original player portrait provider is not connected");
  }
  const layer = view.panel.layer("Original player dialog portrait");
  layer.root.visible = false;
  layer.element.hidden = true;
  view.playerLayer = layer;
  const generation = ++view.playerGeneration;
  view.playerLoading = preparePlayer(view, layer, generation);
}

async function preparePlayer(view, layer, generation) {
  let portrait = null;
  try {
    portrait = await view.context.mountPlayerPortrait(layer, { x: 450, y: 0 });
    if (view.destroyed || view.playerGeneration !== generation) return;
    view.playerPortrait = portrait;
    if (!portrait.bounds) {
      await portrait.refresh(view.context.quests.store.profile);
    }
    if (view.destroyed || view.playerGeneration !== generation) return;
    mountPlayerName(view, layer, portrait);
    placePlayer(view, view.layout.geometry);
    layer.root.visible = true;
    layer.element.hidden = false;
  } catch (error) {
    if (!view.destroyed && view.playerGeneration === generation) {
      view.layout.setError(error.message);
      view.panel.owner.report(error);
    }
  } finally {
    if (view.destroyed || view.playerGeneration !== generation) {
      portrait?.destroy();
    } else view.playerLoading = null;
  }
}

function mountPlayerName(view, layer, portrait) {
  if (!(portrait.bounds?.height > 0) || !Number.isFinite(portrait.bounds.top)) {
    throw new Error("Missing original avatar bounds");
  }
  const bar = view.panel.assets["UtilDlgEx/bar"];
  view.playerBar = layer.image("UtilDlgEx/bar", 0, 0);
  view.playerName = layer.text(
    view.context.quests.store.profile.name,
    0,
    0,
    bar.width,
  );
  view.playerName.style.cssText +=
    ";font:12px/14px Arial,sans-serif;color:#fff;white-space:nowrap;text-align:center;overflow:hidden;";
}

function placePlayer(view, geometry) {
  if (!view.playerBar) return;
  const bounds = view.playerPortrait.bounds;
  const bar = view.panel.assets["UtilDlgEx/bar"];
  // 009a7173 wraps the19px WZ bar in a23px native name canvas.
  const combined = bounds.height + 23;
  const barY =
    combined > geometry.body
      ? geometry.height - combined - 52 + bounds.height
      : 28 + Math.trunc((geometry.body - combined) / 2) + bounds.height;
  const x = 450 - Math.trunc(bar.width / 2);
  view.playerBar.setPosition(x + bar.origin.x, barY + bar.origin.y);
  view.playerName.style.left = `${x}px`;
  view.playerName.style.top = `${barY + 5}px`;
  // 009a78b8: player actor has the original extra4px vertical adjustment.
  view.playerPortrait.setPosition(450, barY - bounds.height - bounds.top + 4);
  view.panel.renderArtwork();
}

function releasePlayer(view) {
  view.playerGeneration++;
  view.playerPortrait?.destroy();
  view.playerLayer?.destroy();
  view.playerPortrait = null;
  view.playerLayer = null;
  view.playerLoading = null;
  view.playerBar = null;
  view.playerName = null;
}

function reflow(view, reset = false) {
  if (view.destroyed || !KINDS.has(view.displayed?.kind)) return;
  const current = view.displayed;
  const geometry = view.layout.reflow(current.kind, current.speaker, reset);
  placeInput(view, geometry);
  layoutPortrait(view, current, geometry);
  setPending(view);
}

function refresh(view) {
  if (view.destroyed) return;
  if (busy(view)) {
    setPending(view);
    return;
  }
  const current = view.session.view;
  if (!current) {
    throw new Error("Start the NPC session before mounting its dialogue");
  }
  if (current === view.displayed) {
    reflow(view);
    return;
  }
  if (!KINDS.has(current.kind)) {
    publishDestination(view, current);
    return;
  }
  view.artRequest?.abort();
  view.displayed = current;
  view.selected = null;
  view.input?.remove();
  view.input = null;
  view.layout.input = null;
  view.panel.content.replaceChildren();
  view.layout.setError();
  renderQuestText(view.panel.content, current.text, view.context.quests, {
    interactive: current.kind === "choice",
    dialogue: true,
    resolver: view.context.resolveToken,
  });
  if (current.kind === "number" || current.kind === "text") {
    makeInput(view, current);
  }
  setControls(view, current);
  reflow(view, true);
  if (view.input) {
    view.input.focus({ preventScroll: true });
    view.input.select();
  } else focusDefault(view);
  const request = new AbortController();
  view.artRequest = request;
  renderDialogArtwork(view.panel, request.signal)
    .then(() => {
      if (!request.signal.aborted && !view.destroyed) reflow(view);
    })
    .catch((error) => {
      if (!request.signal.aborted && !view.destroyed) {
        view.layout.setError(error.message);
        view.panel.owner.report(error);
      }
    });
}

function focusDefault(view) {
  const controls = view.layout.controls;
  for (const key of ["next", "ok", "no", "decline", "back", "close"]) {
    if (controls[key].visible && !controls[key].options.disabled) {
      controls[key].element.focus({ preventScroll: true });
      return;
    }
  }
  view.panel.content
    .querySelector("[data-quest-choice]")
    ?.focus({ preventScroll: true });
}

function publishDestination(view, current) {
  if (view.routed === current || view.destroyed) return;
  if (!["shop", "storage", "closed", "blocked"].includes(current.kind)) {
    throw new Error(`Unsupported NPC view: ${current.kind}`);
  }
  view.routed = current;
  queueMicrotask(() => dispatchDestination(view, current));
}

async function dispatchDestination(view, current) {
  if (view.destroyed) return;
  try {
    if (current.kind === "shop") await view.context.onShop(current);
    else if (current.kind === "storage") await view.context.onStorage(current);
    else if (current.kind === "closed") await view.context.onClose();
    else view.layout.setError(current.reason);
  } catch (error) {
    view.routed = null;
    if (!view.destroyed) view.layout.setError(error.message);
    view.panel.owner.report(error);
  }
}

function refreshSafely(view) {
  try {
    refresh(view);
  } catch (error) {
    if (!view.destroyed) view.layout.setError(error.message);
    view.panel.owner.report(error);
  }
}

function responseError(view, reason) {
  if (!view.destroyed) view.layout.setError(reason);
}

function responseBlocked(view, action) {
  return busy(view) || (action === "close" && view.displayed.speaker & 1);
}

/** Never retries a committed callback. A failed response keeps the exact current DOM, draft and selection. */
async function respond(view, action, value) {
  if (view.destroyed) return false;
  const current = view.displayed;
  if (!current) return false;
  if (action === "close" && view.context.onCancel) {
    return (await view.context.onCancel(current.sessionId)).ok;
  }
  if (responseBlocked(view, action)) return false;
  const response = {
    sessionId: current.sessionId,
    revision: current.revision,
    action,
  };
  if (value !== undefined) response.value = value;
  const focused = document.activeElement;
  view.responding = true;
  setPending(view);
  let result = null;
  try {
    result = await view.session.respond(response);
    if (!result.ok) responseError(view, result.reason);
    await view.context.onOutcome?.(result);
  } catch (error) {
    responseError(view, error.message);
    view.panel.owner.report(error);
  } finally {
    finishResponse(view, result, focused);
  }
  return result?.ok === true;
}

function finishResponse(view, result, focused) {
  view.responding = false;
  if (view.destroyed) return;
  setPending(view);
  if (result?.ok) refreshSafely(view);
  if (!result?.ok && focused?.isConnected) {
    focused.focus({ preventScroll: true });
  }
}

function submit(view) {
  if (busy(view) || view.destroyed) return;
  const current = view.displayed;
  if (current.kind === "choice") {
    if (view.selected !== null) respond(view, "choose", view.selected);
    return;
  }
  if (!view.input) return;
  const draft = view.input.value;
  if (current.kind === "number") {
    submitNumber(view, current, draft);
  } else if (
    draft.length < current.minLength ||
    draft.length > current.maxLength
  ) {
    view.layout.setError(
      `Enter ${current.minLength} to ${current.maxLength} characters.`,
    );
    view.input.focus({ preventScroll: true });
  } else respond(view, "text", draft);
}

function submitNumber(view, current, draft) {
  const value = Number(draft);
  if (
    !/^-?\d+$/.test(draft) ||
    !Number.isSafeInteger(value) ||
    value < current.min ||
    value > current.max
  ) {
    view.layout.setError(
      `Enter a whole number from ${current.min} to ${current.max}.`,
    );
    view.input.focus({ preventScroll: true });
    return;
  }
  respond(view, "number", value);
}

function select(view, button) {
  const id = Number(button.dataset.questChoice);
  if (!view.displayed.choices?.some((choice) => choice.id === id)) return false;
  view.selected = id;
  for (const choice of view.panel.content.querySelectorAll(
    "[data-quest-choice]",
  )) {
    const selected = Number(choice.dataset.questChoice) === id;
    choice.setAttribute("aria-pressed", String(selected));
    if (selected) view.layout.highlightChoice(choice);
  }
  setPending(view);
  return true;
}

function click(view, event) {
  const button = event.target.closest?.("[data-quest-choice]");
  if (!button || !view.panel.content.contains(button) || busy(view)) return;
  if (!select(view, button)) return;
  respond(view, "choose", view.selected);
}

function choiceFocus(view, event) {
  const button = event.target.closest?.("[data-quest-choice]");
  if (!button || !view.panel.content.contains(button) || busy(view)) return;
  select(view, button);
}

function keydown(view, event) {
  if (event.isComposing || event.defaultPrevented) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) respond(view, "close");
  } else if (event.key === "Enter" && event.target === view.input) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) submit(view);
  } else if (event.target === view.input) {
    // Only a real edit control owns typing/navigation, never an ordinary window's movement keys.
    event.stopPropagation();
  } else if (event.repeat && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
  }
}

/**
 * Mount a started NpcScriptSession. context={quests,name(id),resolveToken(token),onOutcome(result),
 * onShop(view),onClose(),mountPlayerPortrait(layer,{x,y}):NativeAvatarPortrait|Promise<NativeAvatarPortrait>}.
 * Cleanup refuses during runtime or publication lease. Main must honor canClose/requestClose before teardown.
 */
export function mountNpcScriptDialogue(panel, session, context) {
  if (
    !session?.view ||
    typeof context?.onShop !== "function" ||
    typeof context?.onClose !== "function"
  ) {
    throw new Error(
      "NPC dialogue requires a started session and owned shop/close callbacks",
    );
  }
  const layout = new NativeDialogLayout(panel);
  const view = {
    panel,
    session,
    context,
    layout,
    portrait: new DialogPortrait(panel),
    displayed: null,
    routed: null,
    selected: null,
    input: null,
    playerPortrait: null,
    playerLayer: null,
    playerGeneration: 0,
    playerLoading: null,
    responding: false,
    destroyed: false,
    artRequest: null,
  };
  listenDialogue(view);
  const cleanup = () => {
    // A server terminal event may retire the panel before the request receipt.
    // The owner has already committed disposal; release resources even in flight.
    if (busy(view) && !panel.disposed) return false;
    if (view.destroyed) return true;
    view.destroyed = true;
    view.artRequest?.abort();
    releasePlayer(view);
    view.portrait.destroy();
    layout.destroy();
    return true;
  };
  cleanup.refresh = () => refreshSafely(view);
  cleanup.canClose = () => Boolean(context.onCancel) || !busy(view);
  cleanup.requestClose = () => respond(view, "close");
  cleanup.update = (ms) => {
    view.playerPortrait?.update(ms);
  };
  try {
    refresh(view);
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}

function listenDialogue(view) {
  const { panel, layout } = view;
  layout.layer.listen(panel.content, "click", (event) => click(view, event));
  layout.layer.listen(panel.content, "pointerover", (event) =>
    choiceFocus(view, event),
  );
  layout.layer.listen(panel.content, "focusin", (event) =>
    choiceFocus(view, event),
  );
  layout.layer.listen(layout.layer.element, "keydown", (event) =>
    keydown(view, event),
  );
}
