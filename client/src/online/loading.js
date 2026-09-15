import { LoadingDecoration } from "../delivery/loading-decoration.js";
import { DownloadDetails, assetLabel } from "./download-details.js";

/** A required startup resource failed; a manual reload is the only bounded recovery. */
export const STARTUP_ASSET_FAILURE_MESSAGE =
  "The files needed to start the game could not be loaded. Reload this page to try again.";

/** Bootstrap failed before the login page existed; the same surface owns that too. */
export const STARTUP_CONNECTION_FAILURE_MESSAGE =
  "The game could not reach the server. Check your connection, then reload this page to try again.";

/** Bounded frontier; the bar never invents work or a percentage. */
const MAX_PLANNED = 4096;

/** Descriptor paths identify a resource; tokens arrive as absolute same-origin URLs. */
function pathOf(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    return new URL(url, "https://assets.invalid").pathname;
  } catch {
    return null;
  }
}

/** Human byte size for the download counters; never used as a progress claim. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Browser-only Windows 95 download presentation. Download and decode tokens own
 * real asynchronous work; the byte frontier only reports what the pipeline itself
 * declared, so a percentage is never invented for undiscovered resources.
 */
export class OnlineLoading {
  constructor(viewport, signal) {
    this.owners = new Set();
    this.maps = new Set();
    this.destroyed = false;
    this.failure = null;
    this.startup = false;
    this.expected = new Map();
    this.finished = new Set();
    this.live = null;
    this.current = null;
    this.shown = 0;
    this.overlay = document.createElement("section");
    this.overlay.id = "delivery-startup";
    this.overlay.hidden = true;
    this.overlay.setAttribute("aria-label", "Preparing game files");
    this.overlay.setAttribute("aria-busy", "true");
    const windowNode = document.createElement("div");
    windowNode.className = "delivery-window";
    const titlebar = document.createElement("div");
    titlebar.className = "delivery-titlebar";
    this.title = document.createElement("span");
    this.title.className = "delivery-title";
    this.title.textContent = "OpenMS";
    titlebar.append(this.title);
    const card = document.createElement("div");
    card.className = "delivery-card";
    this.decoration = new LoadingDecoration(card, signal);
    this.status = document.createElement("p");
    this.status.className = "delivery-status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-atomic", "true");
    this.progress = document.createElement("div");
    this.progress.className = "delivery-progress";
    this.progress.dataset.indeterminate = "true";
    this.progress.setAttribute("role", "progressbar");
    this.progress.setAttribute("aria-label", "Preparing game files");
    this.progress.setAttribute("aria-valuemin", "0");
    this.progress.setAttribute("aria-valuemax", "100");
    this.fill = document.createElement("div");
    this.fill.className = "delivery-fill";
    this.progress.append(this.fill);
    this.count = document.createElement("p");
    this.count.className = "delivery-count";
    this.hint = document.createElement("p");
    this.hint.className = "delivery-hint";
    this.hint.textContent =
      "Keep this tab open. The game continues automatically.";
    card.append(this.status, this.progress, this.count, this.hint);
    windowNode.append(titlebar, card);
    this.overlay.append(windowNode);
    this.downloads = new DownloadDetails(viewport, formatBytes);
    this.downloads.onRefresh = () => this.refresh();
    this.indicator = this.downloads.indicator;
    viewport.append(this.overlay);
    signal.addEventListener("abort", () => this.destroy(), { once: true });
  }

  /** The login page cannot be presented without its artwork; startup owns the surface. */
  beginStartup() {
    if (this.destroyed || this.failure) return;
    this.startup = true;
    this.resetPlan();
    this.overlay.dataset.state = "startup";
    this.refresh();
  }

  /** The login surface published its art; later field loading keeps its own ownership. */
  ready() {
    if (this.destroyed) return;
    this.startup = false;
    this.live = null;
    this.refresh();
  }

  setBackground(state) {
    if (this.destroyed) return;
    this.downloads.background(state);
    this.refresh();
  }

  /** Register resources the startup sequence is about to request, before it requests them. */
  plan(resources) {
    if (this.destroyed) return;
    for (const item of resources ?? []) {
      if (typeof item === "string") this.expect(item, 0);
      else if (item?.url) this.expect(item.url, item.bytes);
    }
    this.refresh();
  }

  /** A validated bundle manifest declares its own immutable atlas/region dependencies. */
  includeManifest(manifest) {
    if (this.destroyed || !this.startup) return;
    this.includeResources(manifest?.regions);
    this.includeResources(Object.values(manifest?.atlases ?? {}));
    this.refresh();
  }

  includeResources(resources) {
    for (const resource of resources ?? []) {
      if (resource?.url) this.expect(resource.url, resource.bytes);
    }
  }

  resetPlan() {
    this.expected.clear();
    this.finished.clear();
    this.live = null;
    this.current = null;
    this.shown = 0;
  }

  expect(url, bytes) {
    const key = pathOf(url);
    if (!key) return;
    const known = Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
    const current = this.expected.get(key);
    if (current === undefined) {
      if (this.expected.size >= MAX_PLANNED) return;
      this.expected.set(key, known);
      return;
    }
    if (known > current) this.expected.set(key, known);
  }

  /** Only an uncached download admitted during map preparation can cover the field. */
  beginMap(descriptor, name = "map assets") {
    const owner = { downloading: false, urls: new Set([descriptor.url]), name };
    this.maps.add(owner);
    // A field replaces the startup surface; its manifest bounds the destination.
    this.startup = false;
    this.resetPlan();
    this.overlay.dataset.state = "map";
    this.expect(descriptor.url, descriptor.bytes);
    return owner;
  }

  /** A validated manifest bounds the destination's exact static region/atlas dependencies. */
  includeMap(owner, manifest) {
    if (!owner) return;
    for (const resource of manifest.regions) owner.urls.add(resource.url);
    for (const resource of Object.values(manifest.atlases)) {
      owner.urls.add(resource.url);
    }
    for (const resource of manifest.regions) {
      this.expect(resource.url, resource.bytes);
    }
    for (const resource of Object.values(manifest.atlases)) {
      this.expect(resource.url, resource.bytes);
    }
    this.refresh();
  }

  endMap(owner) {
    this.maps.delete(owner);
    this.refresh();
  }

  /** Resource tokens include verified cache reads; download tokens mean actual transfers. */
  begin(kind = "asset", url = null, bytes = 0) {
    const owner = { kind, url: pathOf(url) };
    // Once a plan exists, startup also completes its own frontier, so work the plan
    // missed still counts. Before it, the page reports bytes without a total.
    if (owner.url && this.startup && this.expected.size > 0) {
      this.expect(url, bytes);
    }
    this.owners.add(owner);
    if (owner.url && kind !== "asset") this.current = owner.url;
    if (kind === "download") this.markMapDownload(owner.url);
    this.refresh();
    return owner;
  }

  markMapDownload(url) {
    if (!url) return;
    for (const map of this.maps) {
      if (map.urls.has(url)) map.downloading = true;
    }
  }

  /** Encoded progress inside one fetch; a decoded response declares no usable length. */
  stream(url, loaded) {
    const key = pathOf(url);
    if (!key || this.destroyed || this.failure) return;
    this.live = {
      url: key,
      loaded: Number.isFinite(loaded) ? Math.max(0, loaded) : 0,
    };
    this.refresh();
  }

  end(owner) {
    this.owners.delete(owner);
    if (owner.url) {
      this.finished.add(owner.url);
      if (this.live?.url === owner.url) this.live = null;
      // Another token for the same resource may still be streaming it.
      if (this.current === owner.url) {
        this.current = null;
        for (const token of this.owners) {
          if (token.url === owner.url) this.current = owner.url;
        }
      }
    }
    this.refresh();
  }

  refresh() {
    // A required-asset failure owns the surface until the page is reloaded; later
    // map tokens and cache hits must not replace its message or hide it.
    if (this.destroyed || this.failure) return;
    let fullscreen = this.startup;
    for (const map of this.maps) fullscreen ||= map.downloading;
    this.overlay.hidden = !fullscreen;
    if (fullscreen) {
      this.overlay.dataset.state = this.startup ? "startup" : "map";
    }
    this.indicator.hidden =
      fullscreen || (this.owners.size === 0 && !this.downloads?.visible);
    this.render();
    this.downloads?.update({
      active: this.owners.size > 0,
      current: this.current,
      count: this.count.textContent,
    });
  }

  /** Byte frontier and file counters over the resources the pipeline declared. */
  totals() {
    let planned = 0;
    let done = 0;
    let complete = 0;
    for (const [url, bytes] of this.expected) {
      planned += bytes;
      if (!this.finished.has(url)) continue;
      done += bytes;
      complete++;
    }
    const live = this.live;
    if (live) {
      // Descriptor bytes are the decoded size the browser receives. A response's
      // declared length can describe the compressed wire size instead, and a
      // resource outside the frontier (the catalog) has no declared size at all.
      const known = this.expected.get(live.url);
      if (known !== undefined) done += Math.min(live.loaded, known);
    }
    return {
      planned,
      done,
      complete,
      files: this.expected.size,
      streamed: live?.loaded ?? 0,
    };
  }

  render() {
    const totals = this.totals();
    const determinate = totals.planned > 0;
    this.renderBar(determinate, totals);
    this.renderText(determinate, totals);
  }

  renderBar(determinate, { planned, done }) {
    if (!determinate) {
      this.fill.style.width = "";
      this.progress.dataset.indeterminate = "true";
      this.progress.removeAttribute("aria-valuenow");
      return;
    }
    const ratio = Math.max(0, Math.min(1, done / planned));
    this.shown = Math.max(this.shown, Math.min(0.99, ratio));
    this.fill.style.width = `${(this.shown * 100).toFixed(1)}%`;
    this.progress.dataset.indeterminate = "false";
    this.progress.setAttribute(
      "aria-valuenow",
      String(Math.round(this.shown * 100)),
    );
  }

  renderText(determinate, { planned, done, complete, files, streamed }) {
    const downloading =
      this.live || [...this.owners].some((owner) => owner.kind === "download");
    if (!this.startup) {
      const map = this.maps.values().next().value;
      this.status.textContent = `Loading ${map?.name ?? "map assets"}…`;
      this.hint.textContent = assetLabel(this.current);
    } else if (downloading) this.status.textContent = "Downloading game files…";
    else if (determinate && done >= planned && files > 0) {
      this.status.textContent = "Finishing up…";
    } else {
      this.status.textContent = "Checking saved game files…";
    }
    this.overlay.setAttribute("aria-label", this.status.textContent);
    this.progress.setAttribute("aria-label", this.status.textContent);
    const counted = `${complete} of ${files} files`;
    if (determinate) {
      this.count.textContent = `${counted} · ${formatBytes(done)} of ${formatBytes(planned)}`;
    } else if (streamed > 0) {
      this.count.textContent = `${formatBytes(streamed)} downloaded`;
    } else {
      this.count.textContent = files > 0 ? counted : "";
    }
  }

  /**
   * Required login-page resources (catalog, UI or login bundles) failed to load.
   * Keep this one loading surface with an explicit message instead of exposing a
   * login page without art. The optional mushroom image simply stays absent when
   * its own decoration never decoded, so the message remains readable on its own.
   */
  failStartup(message = STARTUP_ASSET_FAILURE_MESSAGE) {
    if (this.destroyed) return;
    this.failure = message;
    this.live = null;
    this.overlay.dataset.state = "error";
    this.overlay.dataset.art =
      this.decoration?.image?.hidden === false ? "shown" : "missing";
    this.overlay.setAttribute("aria-label", "Game files unavailable");
    this.overlay.setAttribute("aria-busy", "false");
    this.progress.hidden = true;
    this.count.hidden = true;
    this.hint.hidden = true;
    this.overlay.hidden = false;
    this.indicator.hidden = true;
    this.status.textContent = message;
  }

  /** Read-only diagnostics; `failure` distinguishes the fallback from ordinary loading. */
  snapshot() {
    const { planned, done, complete, files } = this.totals();
    return {
      visible: !this.overlay.hidden,
      failure: this.failure,
      art: this.failure ? (this.overlay.dataset.art ?? null) : null,
      startup: this.startup,
      files,
      complete,
      plannedBytes: planned,
      preparedBytes: Math.min(done, planned),
      percent: Math.round(this.shown * 100),
      current: this.live?.url ?? this.current ?? null,
    };
  }

  destroy() {
    this.destroyed = true;
    this.owners.clear();
    this.maps.clear();
    this.resetPlan();
    this.indicator.remove();
    this.downloads?.destroy();
    this.overlay.remove();
  }
}
