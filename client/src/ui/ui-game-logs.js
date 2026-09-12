import { UISurface } from "./ui-surface.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";

// Bounded browser diagnostics policy; this is not original GM networking.
const MAX_ERRORS = 64;
const MAX_ERROR_TEXT = 8192;
const ALERT_MS = 8000;
const ALERT_INTERVAL_MS = 2000;
const TRUNCATED = "\n[record truncated]";

function boundedText(text) {
  return text.length <= MAX_ERROR_TEXT
    ? text
    : text.slice(0, MAX_ERROR_TEXT - TRUNCATED.length) + TRUNCATED;
}

/** Preserve stack/message without traversing arbitrary thrown object graphs. */
function errorText(error) {
  try {
    if (error?.name === "AbortError") return null;
    if (typeof error === "string") return boundedText(error);
    if (error === null || error === undefined) return String(error);
    const stack = error.stack;
    if (typeof stack === "string" && stack) return boundedText(stack);
    const message = error.message;
    if (typeof message === "string") return boundedText(message);
    return boundedText(String(error));
  } catch {
    return "An error value was thrown that does not allow reading its message or stack.";
  }
}

/** Both diagnostic surfaces project the same bounded journal without stealing selection. */
function refreshErrorText(input, records) {
  if (!input || document.activeElement === input) return;
  input.value = records.length
    ? records
        .map(
          (record) =>
            `[${record.first}]${record.count > 1 ? ` (${record.count} occurrences; latest ${record.last})` : ""}\n${record.text}`,
        )
        .join("\n\n")
    : "";
}

/** Actual errors only. Repeated signatures update one bounded record without another alert. */
export class GameLogs {
  constructor(owner) {
    this.owner = owner;
    this.records = [];
    this.recentRecords = [];
    this.disposed = false;
    this.notification = null;
    this.notificationController = null;
    this.timer = null;
    this.alertTimer = null;
    this.pendingAlert = false;
    this.lastAlert = -Infinity;
  }

  record(error, notify = true) {
    if (this.disposed) return false;
    const text = errorText(error);
    if (text === null) return false;
    const time = new Date().toISOString();
    const existing = this.records.find((record) => record.text === text);
    if (existing) {
      existing.count = Math.min(Number.MAX_SAFE_INTEGER, existing.count + 1);
      existing.last = time;
    } else {
      if (this.records.length === MAX_ERRORS) {
        const retired = this.records.shift();
        this.recentRecords.splice(this.recentRecords.indexOf(retired), 1);
      }
      this.records.push({ text, first: time, last: time, count: 1 });
      this.diagnostics?.capture(text);
    }
    // Presentation recency is event order, even with equal/backward wall-clock times.
    // Keep the journal-facing records in first-occurrence order.
    const record = existing ?? this.records[this.records.length - 1];
    if (existing) {
      this.recentRecords.splice(this.recentRecords.indexOf(existing), 1);
    }
    this.recentRecords.unshift(record);
    this.refresh();
    if (!existing && notify) {
      this.pendingAlert = true;
      this.presentAlert();
    }
    return !existing;
  }

  refresh() {
    refreshErrorText(document.querySelector("#error"), this.recentRecords);
    const panel = this.owner.windows.get("GameLogs");
    if (!panel?.logText || panel.disposed) return;
    refreshErrorText(panel.logText, this.recentRecords);
  }

  presentAlert() {
    if (
      this.disposed ||
      !this.pendingAlert ||
      !this.owner.hud ||
      this.notificationController
    ) {
      return;
    }
    const delay = ALERT_INTERVAL_MS - (performance.now() - this.lastAlert);
    if (delay > 0) {
      if (this.alertTimer === null) {
        this.alertTimer = setTimeout(() => {
          this.alertTimer = null;
          this.presentAlert();
        }, delay);
      }
      return;
    }
    this.pendingAlert = false;
    this.lastAlert = performance.now();
    if (this.notification) {
      this.showNotification();
      return;
    }
    const controller = new AbortController();
    this.notificationController = controller;
    this.loadNotification(controller)
      .catch((error) => {
        if (!controller.signal.aborted) this.record(error, false);
      })
      .finally(() => {
        if (this.notificationController === controller) {
          this.notificationController = null;
          this.presentAlert();
        }
      });
  }

  /** Advance only native control rasters; diagnostic text is never rebuilt per frame. */
  update(ms) {
    if (this.notification && !this.notification.element.hidden) {
      this.notification.update(ms);
    }
  }

  async loadNotification(controller) {
    const resource = await loadVisualBundle(
      this.owner.index.bundles.TradingRoom,
      this.owner.services,
      controller.signal,
    );
    if (controller.signal.aborted || this.disposed) {
      resource.destroy();
      return;
    }
    const panel = new UISurface(
      this.owner,
      "Game error notification",
      resource,
      [208, 37],
    );
    try {
      layoutErrorNotification(panel);
      panel.renderArtwork();
    } catch (error) {
      panel.destroy();
      throw error;
    }
    this.notification = panel;
    this.showNotification();
  }

  showNotification() {
    const panel = this.notification;
    if (!panel || this.disposed) return;
    panel.element.hidden = false;
    panel.element.style.zIndex = "90";
    this.resize();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.dismissNotification(), ALERT_MS);
    // The integration owns native audio admission and rejection handling.
    this.owner.hooks.onErrorNotification?.();
  }

  resize() {
    const panel = this.notification;
    if (!panel) return;
    // Share the actual request placement helper and its centered 800×600 HUD plane.
    panel.renderArtwork();
    this.owner.positionInvitation(panel);
  }

  dismissNotification() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.notification) this.notification.element.hidden = true;
  }

  releaseNotification() {
    clearTimeout(this.alertTimer);
    this.alertTimer = null;
    this.notificationController?.abort();
    this.notificationController = null;
    this.dismissNotification();
    this.notification?.destroy();
    this.notification = null;
  }

  destroy() {
    this.disposed = true;
    this.releaseNotification();
    this.records.length = 0;
  }
}

/** Reuse Notice3/4 original compact tiles; dimensions/text editor are browser diagnostics policy. */
export function layoutGameLogs(panel) {
  panel.element.setAttribute("aria-label", "Game Logs");
  panel.element.setAttribute("role", "dialog");
  panel.image("Notice3/t", 0, 0);
  for (let row = 0; row < 15; row++) panel.image("Notice3/c", 0, 21 + row * 20);
  panel.image("Notice4/s", 0, 321);
  panel.text("Game Logs", 20, 5, 220);
  const text = document.createElement("textarea");
  text.readOnly = true;
  text.spellcheck = false;
  text.setAttribute("aria-label", "Game error records");
  text.placeholder = "No errors recorded in this session.";
  text.style.cssText =
    "position:absolute;left:20px;top:26px;width:225px;height:243px;box-sizing:border-box;resize:none;pointer-events:auto;font:11px/15px monospace;background:#fff;color:#111;";
  panel.element.append(text);
  panel.logText = text;
  panel.listen(text, "blur", () => panel.owner.logs.refresh());
  panel.listen(text, "keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    panel.owner.close(panel.name);
  });
  panel.localButton("Select", 20, 346, () => {
    text.focus();
    text.select();
  });
  layoutDiagnosticActions(panel);
  panel.button("BtOK2", 208, 369, {
    label: "Close Game Logs",
    action: () => panel.owner.close(panel.name),
  });
  panel.text("Local JSON only. No upload.", 20, 324, 225);
}

/** Original005203bb request frame/control coordinates, adapted solely for local errors. */
function layoutErrorNotification(panel) {
  panel.image("FadeYesNo/backgrnd", 0, 0);
  const title = panel.text("Game error recorded", 12, 5, 160);
  const detail = panel.text("Open Game Logs for details", 12, 18, 160);
  for (const text of [title, detail]) {
    text.style.cssText +=
      "font:11px/13px Arial,sans-serif;color:#ff4040;white-space:nowrap;overflow:hidden;";
  }
  panel.element.setAttribute("role", "status");
  panel.element.setAttribute("aria-live", "polite");
  panel.button("FadeYesNo/BtOK", 177, 7, {
    label: "Open Game Logs",
    action: () => {
      panel.owner.logs.dismissNotification();
      panel.owner.open("GameLogs").catch((error) => panel.owner.report(error));
    },
  });
  panel.button("FadeYesNo/BtCancel", 177, 20, {
    label: "Dismiss game error notification",
    action: () => panel.owner.logs.dismissNotification(),
  });
}

/** Native controls own all import/replay admission. Failure text never recursively records itself. */
function layoutDiagnosticActions(panel) {
  const status = panel.text(
    "Local dumps include profile, account and chat. No upload.",
    20,
    274,
    225,
  );
  status.style.cssText += "font:11px/14px Arial;white-space:normal;";
  status.setAttribute("role", "status");
  const file = document.createElement("input");
  file.type = "file";
  file.accept = ".json,application/json";
  file.hidden = true;
  file.setAttribute("aria-label", "Import local game diagnostic JSON");
  panel.element.append(file);
  const state = {
    diagnostics: panel.owner.logs.diagnostics,
    status,
    file,
    read: null,
  };
  panel.cleanups.push(() => {
    state.read = null;
  });
  panel.localButton("Export JSON", 75, 346, () => exportDiagnostic(state));
  state.importButton = panel.localButton("Import", 173, 346, () =>
    file.click(),
  );
  panel.listen(file, "change", () => importDiagnostic(panel, state));
  state.replayButton = panel.localButton("Replay locally", 20, 369, (event) =>
    replayDiagnostic(panel, state, event),
  );
}

function exportDiagnostic(state) {
  try {
    const json = state.diagnostics.exportJSON();
    const url = URL.createObjectURL(
      new Blob([json], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "maple-game-diagnostic.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    state.status.textContent =
      "Exported full local diagnostic; it may contain private chat/account data.";
  } catch (error) {
    state.status.textContent = error.message;
  }
}

/** A retired panel cannot publish a late File.text result over a newer imported selection. */
async function importDiagnostic(panel, state) {
  const selected = state.file.files?.[0];
  if (!selected || state.read || panel.disposed) return;
  const token = {};
  state.read = token;
  state.importButton.disabled = true;
  state.replayButton.disabled = true;
  try {
    if (selected.size > 16 * 1024 * 1024) {
      throw new Error("Diagnostic JSON exceeds 16 MiB");
    }
    const json = await selected.text();
    if (state.read !== token || panel.disposed) return;
    state.status.textContent = state.diagnostics.importJSON(json);
  } catch (error) {
    if (state.read === token && !panel.disposed) {
      state.status.textContent = error.message;
    }
  } finally {
    if (state.read === token) {
      state.read = null;
      state.file.value = "";
      state.importButton.disabled = false;
      state.replayButton.disabled = false;
    }
  }
}

async function replayDiagnostic(panel, state, event) {
  const diagnostics = state.diagnostics;
  if (!event.isTrusted || state.read || !diagnostics || diagnostics.replaying) {
    return;
  }
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Local replay · Cancel / Escape";
  cancel.style.cssText =
    "position:absolute;left:8px;top:8px;z-index:2147483647;";
  const stop = () => diagnostics.cancel();
  cancel.addEventListener("click", stop);
  panel.owner.app.canvas.parentElement.append(cancel);
  try {
    state.status.textContent = await diagnostics.replay();
  } catch (error) {
    state.status.textContent = error.message;
  } finally {
    cancel.removeEventListener("click", stop);
    cancel.remove();
  }
}
