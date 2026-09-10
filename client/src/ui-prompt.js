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

function inputField(panel, request) {
  const input = document.createElement("input");
  input.type = request.kind === "number" ? "number" : "text";
  input.setAttribute("aria-label", request.text);
  input.style.cssText =
    "position:absolute;left:24px;top:122px;width:480px;height:22px;font:12px Arial,sans-serif;color:#222;background:white;border:1px solid #888;";
  if (request.kind === "number") {
    input.min = String(request.min);
    input.max = String(request.max);
    input.step = "1";
    input.required = true;
  } else input.maxLength = request.maxLength ?? MAX_PROMPT_TEXT;
  input.value = String(
    request.value ?? (request.kind === "number" ? request.min : ""),
  );
  panel.element.append(input);
  panel.promptInput = input;
}

/** Original UtilDlgEx pieces and Basic controls; no browser modal or second reply schema. */
export function layoutPrompt(panel) {
  const state = panel.owner.promptRequest;
  if (!state) throw new Error("Native prompt has no request owner");
  panel.promptState = state;
  panel.nativeClose = true;
  panel.image("UtilDlgEx/t", 0, 0);
  for (let row = 0; row < 6; row++) {
    panel.image("UtilDlgEx/c", 0, 28 + row * 20);
  }
  panel.image("UtilDlgEx/s", 0, 148);
  const hasInput =
    state.request.kind === "text" || state.request.kind === "number";
  const content = panel.contentArea(24, 30, 480, hasInput ? 86 : 116);
  content.textContent = state.request.text;
  content.style.cssText +=
    "font:12px Arial,sans-serif;line-height:18px;overflow:auto;";
  if (hasInput) inputField(panel, state.request);
  panel.button("BtOK", 300, 176, {
    label: "OK",
    action: () => submitPrompt(panel),
  });
  if (state.request.kind !== "notice") {
    panel.promptCancel = panel.button("BtCancel2", 355, 176, {
      label: "Cancel",
      action: () =>
        settlePrompt(
          panel.owner,
          state,
          state.request.kind === "confirm" ? false : null,
        ),
    });
  }
  panel.cleanups.push(() => settlePrompt(panel.owner, state, null));
}
