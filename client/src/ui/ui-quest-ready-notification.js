import { loadVisualBundle } from "../rendering/visual-resources.js";
import { UISurface } from "./ui-surface.js";

// Original00523408 /0051f93d: entrance, hold and exit milliseconds.
const FADE_MS = 1000;
const HOLD_MS = 30000;
const TOTAL_MS = FADE_MS * 2 + HOLD_MS;
const MAX_PENDING = 4096; // Browser catalog bound, not a native queue limit.
const OPACITY = Array.from({ length: 256 }, (_, alpha) => String(alpha / 255));

/** One screen-owned FadeYesNo resource and a bounded event queue. Profile publication
 * supplies readiness edges; painting, resize and audio activation never produce edges.
 */
export class QuestReadyNotification {
  constructor(owner) {
    this.owner = owner;
    this.resource = null;
    this.quests = null;
    this.pending = [];
    this.active = null;
    this.destroyed = false;
    this.shown = 0;
  }

  async prepare(signal) {
    if (this.destroyed) {
      throw new Error("Quest readiness notification is destroyed");
    }
    if (this.resource) return;
    const resource = await loadVisualBundle(
      this.owner.index.bundles.TradingRoom,
      this.owner.services,
      signal,
    );
    if (signal.aborted || this.destroyed) {
      resource.destroy();
      throw new DOMException(
        "Quest notification preparation cancelled",
        "AbortError",
      );
    }
    this.resource = resource;
  }

  /** Call after a durable publication, never on an uncommitted inventory/kill draft. */
  refresh(quests) {
    if (this.destroyed) return;
    if (quests !== this.quests) {
      this.clear();
      this.quests = quests;
      quests?.resetReadiness();
    }
    if (!quests) return;
    const changes = quests.readinessChanges();
    for (const id of changes.removed) {
      this.pending = this.pending.filter((record) => record.id !== id);
      if (this.active?.record.id === id) this.retire();
    }
    if (this.pending.length + changes.ready.length > MAX_PENDING) {
      throw new Error(
        "Quest readiness notification queue exceeds the catalog bound",
      );
    }
    for (const record of changes.ready) this.pending.push(record);
    this.present();
  }

  /** Browser queue serialization avoids obscuring multiple simultaneous ready quests. */
  present() {
    if (this.active || !this.resource || this.destroyed) return;
    for (let count = 0; count < MAX_PENDING && this.pending.length; count++) {
      const record = this.pending.shift();
      if (!this.quests.isReady(record)) continue;
      const panel = new UISurface(
        this.owner,
        "Quest ready notification",
        this.resource,
        [155, 44],
      );
      panel.ownsResource = false;
      try {
        layoutNotification(panel, record, this);
        panel.renderArtwork();
      } catch (error) {
        panel.destroy();
        throw error;
      }
      panel.element.style.opacity = OPACITY[0];
      this.active = { record, panel, elapsed: 0, alpha: 0 };
      this.shown++;
      this.resize();
      // 00523601..0052361c: exact UI/Invite, not the reward's Game/QuestClear.
      // GameUI owns native autoplay admission/error reporting; no deferred retry.
      this.owner.sound("Invite");
      return;
    }
  }

  update(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError("Invalid quest notification elapsed milliseconds");
    }
    const active = this.active;
    if (!active) return this.present();
    active.elapsed += ms;
    if (active.elapsed >= TOTAL_MS) {
      this.retire();
      return this.present();
    }
    const remaining = TOTAL_MS - active.elapsed;
    const fraction = Math.min(1, active.elapsed / FADE_MS, remaining / FADE_MS);
    const alpha = Math.trunc(fraction * 255);
    if (alpha !== active.alpha) {
      active.alpha = alpha;
      active.panel.element.style.opacity = OPACITY[alpha];
    }
    active.panel.update(ms);
  }

  resize() {
    if (!this.active) return;
    const panel = this.active.panel;
    panel.renderArtwork();
    // Retain the existing viewport/HUD ownership and y508 FadeYesNo plane.
    // HUD-right anchoring is the same documented browser policy as social requests.
    this.owner.positionInvitation(panel);
  }

  async openJournal() {
    const active = this.active;
    if (!active) return;
    await this.owner.open("Quest");
    if (this.active === active) this.retire();
  }

  retire() {
    this.active?.panel.destroy();
    this.active = null;
  }

  clear() {
    this.pending.length = 0;
    this.retire();
  }

  snapshot() {
    return {
      active: this.active
        ? { questId: this.active.record.id, elapsedMs: this.active.elapsed }
        : null,
      pending: this.pending.map((record) => record.id),
      shown: this.shown,
      source: "UI.wz:UIWindow.img/FadeYesNo/backgrnd4",
      sound: "Sound.wz:UI.img/Invite",
      loadedReadyPolicy: "silent-baseline",
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clear();
    this.resource?.destroy();
    this.resource = null;
    this.quests = null;
  }
}

/** 0052065d case7 paints title at27,7 and original QuestInfo name at27,20. */
function layoutNotification(panel, record, notifications) {
  panel.image("FadeYesNo/backgrnd4", 0, 0);
  // 0052065d's shared copy centers the icon in the37px content height.
  const icon = panel.assets["FadeYesNo/icon7"];
  if (!icon) throw new Error("Original quest readiness icon is unavailable");
  panel.image("FadeYesNo/icon7", 6, Math.trunc((37 - icon.height) / 2));
  panel.element.setAttribute("role", "status");
  panel.element.setAttribute("aria-live", "polite");
  panel.element.dataset.questId = String(record.id);
  panel.element.style.zIndex = "90";
  const title =
    Number(record.info?.type) === 51 ? "You got a title!" : "Quest Complete!";
  for (const [text, y] of [
    [title, 7],
    [record.name, 20],
  ]) {
    const label = panel.text(text, 27, y, 121);
    label.title = text;
    label.style.cssText +=
      "font:12px/13px Arial,sans-serif;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:none;";
  }
  panel.hit(
    `Open quest journal: ${record.name}`,
    { x: 0, y: 0, width: 155, height: 44 },
    {
      click: () =>
        notifications.openJournal().catch((error) => panel.owner.report(error)),
    },
  );
}
