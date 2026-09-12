import { layoutCompactInput } from "./ui-meso-dialog.js";

const PROMPT_KINDS = new Set(["text", "number", "confirm", "notice"]);
const MAX_PROMPT_TEXT = 8192;

function validateRequest(request) {
  if (
    !request ||
    !PROMPT_KINDS.has(request.kind) ||
    typeof request.text !== "string" ||
    request.text.length > MAX_PROMPT_TEXT
  ) {
    throw new TypeError("Invalid native prompt request");
  }
  validateInputLimits(request);
}

function validateInputLimits(request) {
  if (
    request.kind === "number" &&
    (!Number.isSafeInteger(request.min) ||
      !Number.isSafeInteger(request.max) ||
      request.min > request.max)
  ) {
    throw new TypeError("Invalid native number prompt range");
  }
  if (
    request.maxLength !== undefined &&
    (!Number.isInteger(request.maxLength) ||
      request.maxLength < 1 ||
      request.maxLength > MAX_PROMPT_TEXT)
  ) {
    throw new TypeError("Invalid native text prompt limit");
  }
}

/** A single visible modal owner settles every terminal/cancellation path exactly once. */
export function requestPrompt(owner, request) {
  validateRequest(request);
  if (
    owner.disposed ||
    request.signal?.aborted ||
    owner.promptRequest ||
    owner.hooks.isOperationPending?.(request.owner ?? null)
  ) {
    return Promise.resolve(null);
  }
  const modal = owner.modal();
  if (modal && !ownsPromptModal(request, modal)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const state = { request, resolve, abort: null, settled: false };
    state.abort = () => settlePrompt(owner, state, null);
    owner.promptRequest = state;
    request.signal?.addEventListener("abort", state.abort, { once: true });
    owner.hooks.clearInput();
    owner.open("NativePrompt", request.signal).catch((error) => {
      settlePrompt(owner, state, null);
      owner.report(error);
    });
  });
}

function ownsPromptModal(request, modal) {
  return (
    request.owner &&
    (request.owner === modal ||
      request.owner === modal?.operationOwner ||
      request.owner === modal?.dialogCleanup)
  );
}

export function settlePrompt(owner, state, value) {
  if (!state || state.settled) return false;
  state.settled = true;
  state.request.signal?.removeEventListener("abort", state.abort);
  if (owner.promptRequest === state) owner.promptRequest = null;
  owner.close("NativePrompt", true);
  state.resolve(value);
  return true;
}

function promptValue(panel) {
  const { request } = panel.promptState;
  if (request.kind === "confirm" || request.kind === "notice") return true;
  const input = panel.promptInput;
  if (!input.reportValidity()) return undefined;
  if (request.kind === "text") return input.value;
  if (!/^-?\d+$/.test(input.value)) return undefined;
  const value = Number(input.value);
  return Number.isSafeInteger(value) &&
    value >= request.min &&
    value <= request.max
    ? value
    : undefined;
}

export function submitPrompt(panel) {
  const value = promptValue(panel);
  if (value === undefined) return false;
  return settlePrompt(panel.owner, panel.promptState, value);
}

/** The bundle is selected before synchronous composition and contains only native artwork. */
export function promptBundleName(request) {
  return request?.kind === "number" || request?.kind === "text"
    ? "MesoDrop"
    : "UtilDlg";
}

function inputField(panel, request) {
  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("aria-label", request.text);
  input.style.cssText = `position:absolute;left:19px;top:${panel.height - 73}px;width:226px;height:15px;box-sizing:border-box;border:0;border-radius:0;background:transparent;color:black;font:12px/15px Arial,sans-serif;text-align:right;padding:0 2px;`;
  if (request.kind === "number") {
    input.inputMode = "numeric";
    // Canonical prompt API admits safe integers, including a sign; unlike the
    // native ten-digit mesos editor this shared browser editor must retain them.
    input.maxLength = 17;
    input.required = true;
    input.setAttribute(
      "aria-description",
      `Amount: ${request.min} to ${request.max}`,
    );
  } else {
    input.maxLength = request.maxLength ?? MAX_PROMPT_TEXT;
    input.style.textAlign = "left";
  }
  input.value = String(
    request.value ?? (request.kind === "number" ? request.min : ""),
  );
  panel.element.append(input);
  panel.promptInput = input;
}

/** CUtilDlg00991803/00991878 uses20px tiles enclosing14px text lines. */
function layoutConfirmation(panel, request) {
  const content = panel.text(request.text, 20, 24, 200);
  content.style.cssText +=
    "font:12px/14px Arial,sans-serif;color:#000;white-space:pre-wrap;overflow-wrap:break-word;";
  const measured = content.scrollHeight;
  if (!Number.isFinite(measured) || measured < 0) {
    throw new Error("Confirmation must be measured in a visible UI surface");
  }
  // Browser containment policy, not an original CUtilDlg text-height limit.
  const available = panel.owner.viewportHeight / panel.owner.scale - 76;
  const maxRows = Math.max(
    2,
    Math.floor((Number.isFinite(available) ? available : 4096) / 20),
  );
  const rows = Math.min(maxRows, Math.max(2, Math.floor(measured / 20) + 1));
  panel.width = 266;
  panel.height = 76 + rows * 20;
  panel.element.style.width = `${panel.width}px`;
  panel.element.style.height = `${panel.height}px`;
  content.style.top = `${24 + Math.max(0, (rows * 20 - measured) / 2)}px`;
  content.style.maxHeight = `${rows * 20}px`;
  content.style.overflow = "auto";
  content.style.pointerEvents = "auto";
  const branch = request.kind === "notice" ? "Notice3" : "YesNo3";
  panel.image(`${branch}/t`, 0, 0);
  for (let row = 0; row < rows; row++) {
    panel.image(`${branch}/c`, 0, 21 + row * 20);
  }
  panel.image(`${branch}/s`, 0, 21 + rows * 20);
}

/** Ordinary prompts never borrow the portrait-bearing NPC UtilDlgEx window. */
export function layoutPrompt(panel) {
  const state = panel.owner.promptRequest;
  if (!state) throw new Error("Native prompt has no request owner");
  panel.promptState = state;
  panel.nativeClose = true;
  const hasInput =
    state.request.kind === "text" || state.request.kind === "number";
  if (hasInput) {
    layoutCompactInput(panel, state.request.text);
    inputField(panel, state.request);
  } else layoutConfirmation(panel, state.request);
  const okX = hasInput ? 158 : state.request.kind === "notice" ? 205 : 155;
  panel.button("BtOK2", okX, panel.height - 30, {
    label: "OK",
    action: () => submitPrompt(panel),
  });
  if (state.request.kind !== "notice") {
    panel.promptCancel = panel.button(
      "BtCancel2",
      hasInput ? 208 : 205,
      panel.height - 30,
      {
        label: "Cancel",
        action: () =>
          settlePrompt(
            panel.owner,
            state,
            state.request.kind === "confirm" ? false : null,
          ),
      },
    );
  }
  panel.cleanups.push(() => settlePrompt(panel.owner, state, null));
}
