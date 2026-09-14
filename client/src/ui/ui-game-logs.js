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
  panel.image("Notice4/t", 0, 0);
  panel.image("Notice4/s", 0, 321);
  // Tile over the prompt-only input well, retaining the native bottom 18px border.
  for (let row = 0; row < 18; row++) panel.image("Notice4/c", 0, 21 + row * 20);
  panel.text("Game Logs", 12, 5, 242);
  const text = document.createElement("textarea");
  text.readOnly = true;
  text.spellcheck = false;
  text.setAttribute("aria-label", "Game error records");
  text.placeholder = "No errors recorded in this session.";
  text.style.cssText =
    "position:absolute;left:12px;top:28px;width:242px;height:304px;box-sizing:border-box;resize:none;pointer-events:auto;font:11px/15px monospace;background:#fff;color:#111;";
  panel.element.append(text);
  panel.logText = text;
  panel.listen(text, "blur", () => panel.owner.logs.refresh());
  panel.listen(text, "keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    panel.owner.close(panel.name);
  });
  logButton(panel, "Select", [12, 340, 56], () => {
    text.focus();
    text.select();
  });
  const close = logButton(panel, "Close", [180, 340, 74], () =>
    panel.owner.close(panel.name),
  );
  close.setAttribute("aria-label", "Close Game Logs");
}

/** Fixed footer grid inside the 266px native frame; diagnostics have no original button art. */
function logButton(panel, label, [x, y, width], action) {
  const button = panel.localButton(label, x, y, action);
  button.style.cssText += `width:${width}px;height:22px;box-sizing:border-box;padding:0 4px;font:11px/20px Arial;`;
  return button;
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
