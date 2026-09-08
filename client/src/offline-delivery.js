import {
  DELIVERY_LIMITS,
  boundedResponse,
  validateRelease,
} from "../public/offline-manifest.js";

const REQUEST_TIMEOUT_MS = 120000;
const MAX_UNCACHED = 65536;

function size(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function node(tag, text, parent) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (parent) parent.append(element);
  return element;
}

function button(text, parent, handler) {
  const element = node("button", text, parent);
  element.type = "button";
  element.addEventListener("click", handler);
  return element;
}

/** Append the packaged closure without changing the selected release's ordering. */
function appendManifestContent(lines, manifest) {
  if (!manifest) return;
  lines.push("Packaged map closure:");
  for (const map of manifest.maps) lines.push(`${map.id}: ${map.name}`);
  lines.push(
    "Authored portal destinations outside this release (not downloadable):",
  );
  if (manifest.unavailableMaps) {
    for (const id of manifest.unavailableMaps) lines.push(String(id));
  }
}

/** Missing entries remain distinct for installed, staged, and resumable releases. */
function appendMissingContent(lines, record, label) {
  if (!record?.missing?.length) return;
  lines.push(label);
  for (const entry of record.missing) lines.push(entry);
}

async function activeWorker() {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Offline worker activation timed out")),
      30000,
    );
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** A native browser sidebar, explicitly separate from recovered game UI artwork. */
export class OfflineDelivery {
  constructor(parent) {
    this.registration = null;
    this.available = null;
    this.state = null;
    this.storage = null;
    this.error = null;
    this.verification = null;
    this.busy = false;
    this.destroyed = false;
    this.requests = new Set();
    this.uncached = new Set();
    this.listeners = new AbortController();
    this.onMessage = this.onMessage.bind(this);
    this.onConnection = this.onConnection.bind(this);
    this.root = node("fieldset", "", parent);
    this.root.id = "offline-delivery";
    node("legend", "Offline download · local browser policy", this.root);
    this.summary = node("p", "Checking offline support…", this.root);
    this.summary.setAttribute("role", "status");
    this.progress = node("progress", "", this.root);
    this.progress.hidden = true;
    this.details = node("p", "", this.root);
    this.details.className = "hint";
    const controls = node("div", "", this.root);
    controls.className = "button-row";
    this.downloadButton = button("Download complete release", controls, () =>
      this.run("download"),
    );
    this.cancelButton = button("Cancel download", controls, () =>
      this.run("cancel"),
    );
    this.activateButton = button(
      "Use installed release and reload",
      this.root,
      () => this.run("activate"),
    );
    this.checkButton = button(
      "Verify installed / check update",
      this.root,
      () => this.run("refresh"),
    );
    this.errors = node("p", "", this.root);
    this.errors.setAttribute("role", "alert");
    const content = node("details", "", this.root);
    node("summary", "Packaged and unavailable content", content);
    this.content = node("pre", "", content);
    this.content.style.whiteSpace = "pre-wrap";
  }
  async initialize() {
    if (
      !window.isSecureContext ||
      !("serviceWorker" in navigator) ||
      !("caches" in window)
    ) {
      this.error =
        "Offline installation requires CacheStorage and service workers on localhost or HTTPS.";
      this.render();
      return this;
    }
    try {
      this.registration = await navigator.serviceWorker.getRegistration("/");
      if (!this.registration) {
        this.registration = await navigator.serviceWorker.register(
          "/service-worker.js",
          { type: "module", scope: "/", updateViaCache: "none" },
        );
      }
      this.registration = await activeWorker();
      navigator.serviceWorker.addEventListener("message", this.onMessage, {
        signal: this.listeners.signal,
      });
      window.addEventListener("online", this.onConnection, {
        signal: this.listeners.signal,
      });
      window.addEventListener("offline", this.onConnection, {
        signal: this.listeners.signal,
      });
      this.linkManifest();
      this.ready = this.refresh().catch((error) => {
        this.error = error.message;
        this.render();
      });
    } catch (error) {
      this.error = error.message;
      this.render();
    }
    return this;
  }
  linkManifest() {
    if (document.querySelector('link[rel="manifest"]')) return;
    this.manifestLink = document.createElement("link");
    this.manifestLink.rel = "manifest";
    this.manifestLink.href = "/app.webmanifest";
    document.head.append(this.manifestLink);
  }
  onConnection() {
    this.render();
  }
  onMessage(event) {
    if (event.data?.type !== "OFFLINE_UNCACHED") return;
    if (this.uncached.size >= MAX_UNCACHED) {
      this.error =
        "Uncached content inventory limit exceeded; verify the installed release.";
    } else this.uncached.add(`${event.data.url}: ${event.data.error}`);
    this.render();
  }
  async run(action) {
    try {
      if (action === "download") await this.download();
      else if (action === "cancel") await this.cancel();
      else if (action === "activate") await this.activate();
      else if (action === "refresh") await this.refresh();
    } catch (error) {
      this.error = error.message;
    }
    this.render();
  }
  /** Commands only name a release hash; callers can never supply download URLs. */
  request(type, releaseId = null) {
    if (this.destroyed) {
      return Promise.reject(new Error("Offline panel destroyed"));
    }
    const worker = this.registration?.active;
    if (!worker) {
      return Promise.reject(new Error("Offline worker is not active"));
    }
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const request = { channel, reject, timer: null };
      const finish = (error, result) => {
        clearTimeout(request.timer);
        this.requests.delete(request);
        this.verification = null;
        channel.port1.close();
        if (error) reject(error);
        else resolve(result);
      };
      const expire = () =>
        finish(
          new Error(
            "Offline worker stopped responding. Verify readiness before retrying; the last installed release is retained.",
          ),
        );
      request.timer = setTimeout(expire, REQUEST_TIMEOUT_MS);
      channel.port1.onmessage = (event) => {
        clearTimeout(request.timer);
        if (
          event.data.type === "PROGRESS" ||
          event.data.type === "VERIFY_PROGRESS"
        ) {
          request.timer = setTimeout(expire, REQUEST_TIMEOUT_MS);
          if (!this.state) this.state = {};
          if (event.data.type === "PROGRESS") {
            this.state.job = event.data.progress;
          } else this.verification = event.data.progress;
          this.render();
        } else if (event.data.type === "ERROR") {
          finish(new Error(event.data.error));
        } else finish(null, event.data.result);
      };
      this.requests.add(request);
      worker.postMessage({ type, releaseId }, [channel.port2]);
    });
  }
  async measureStorage(requestPersistence = false) {
    const storage = navigator.storage;
    if (!storage) {
      this.storage = { supported: false };
      return;
    }
    const persisted =
      requestPersistence && storage.persist
        ? await storage.persist()
        : await storage.persisted?.();
    const estimate = await storage.estimate?.();
    this.storage = {
      supported: true,
      persisted: Boolean(persisted),
      quota: estimate?.quota,
      usage: estimate?.usage,
    };
  }
  async checkAvailable() {
    try {
      const response = await fetch("/generated/release.json", {
        cache: "no-store",
        signal: this.listeners.signal,
      });
      const bytes = await boundedResponse(
        response,
        DELIVERY_LIMITS.manifestBytes,
        this.listeners.signal,
      );
      this.available = await validateRelease(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      return null;
    } catch (error) {
      return `Update check unavailable: ${error.message}`;
    }
  }
  async refresh() {
    if (this.busy || this.destroyed) return this.snapshot();
    this.busy = true;
    this.render();
    try {
      this.error = null;
      this.state = await this.request("OFFLINE_STATUS");
      await this.measureStorage();
      const updateError = await this.checkAvailable();
      if (updateError) this.error = updateError;
    } finally {
      this.busy = false;
      this.render();
    }
    return this.snapshot();
  }
  async download() {
    if (this.busy) throw new Error("Offline operation already in progress");
    const id = this.state?.partial?.releaseId ?? this.available?.releaseId;
    if (!id) {
      throw new Error("Check for a published release while online first");
    }
    this.busy = true;
    this.error = null;
    if (this.state) this.state.error = null;
    this.render();
    try {
      await this.measureStorage(true);
      await this.request("DOWNLOAD_RELEASE", id);
    } finally {
      this.busy = false;
      this.state = await this.request("OFFLINE_STATUS");
      await this.measureStorage();
      this.render();
    }
    return this.snapshot();
  }
  async cancel() {
    const result = await this.request("CANCEL_DOWNLOAD");
    if (result.cancelled) this.error = null;
    if (!result.cancelled) {
      this.error =
        "No cancellable download is running (the verified pointer may already be committing).";
    }
    if (!this.busy) await this.refresh();
    return result;
  }
  async activate() {
    const staged = this.state?.staged;
    if (staged?.ready) await this.request("ACTIVATE_RELEASE", staged.releaseId);
    else if (!this.state?.active?.ready) {
      throw new Error("No verified complete release is available");
    }
    window.location.reload();
  }
  snapshot() {
    return {
      state: this.state,
      available: this.available,
      storage: this.storage,
      error: this.error,
      online: navigator.onLine,
      uncached: [...this.uncached],
    };
  }
  render() {
    if (this.destroyed) return;
    const active = this.state?.active;
    const staged = this.state?.staged;
    const job = this.state?.job;
    this.summary.textContent = this.summaryText(active, staged, job);
    this.progress.hidden = !job;
    if (job) {
      this.progress.max = job.totalBytes || 1;
      this.progress.value = job.completedBytes;
    }
    this.renderControls(active, staged, job);
    this.errors.textContent = this.error || this.state?.error || "";
    this.details.textContent = this.storageText();
    this.renderContent();
  }

  renderDownload(job) {
    const partial = this.state?.partial;
    const downloadable = this.available ?? partial;
    this.downloadButton.disabled =
      this.busy || Boolean(job) || !downloadable || !this.registration?.active;
    this.downloadButton.textContent = partial
      ? "Resume complete release download"
      : "Download complete release";
    this.cancelButton.disabled = !job && !partial;
  }

  renderControls(active, staged, job) {
    this.renderDownload(job);
    const launchable = staged?.ready || active?.ready;
    this.activateButton.disabled = this.busy || !launchable;
    this.checkButton.disabled =
      this.busy || Boolean(job) || !this.registration?.active;
  }
  summaryText(active, staged, job) {
    if (this.busy && !this.state) {
      return "Checking installation; offline readiness is not yet verified.";
    }
    if (this.verification) {
      return `Verifying installed bytes: ${size(this.verification.completedBytes)} / ${size(this.verification.totalBytes)}. ${this.verification.current}`;
    }
    if (job) {
      return `Downloading ${job.completedEntries}/${job.totalEntries}: ${size(job.completedBytes)} / ${size(job.totalBytes)}. ${job.current}. Not ready until verified.`;
    }
    return this.releaseSummary(active, staged);
  }

  releaseSummary(active, staged) {
    if (staged?.ready) {
      return `Complete release ${staged.releaseId.slice(0, 12)} verified (${size(staged.totalBytes)}). Use installed release and reload to switch atomically.`;
    }
    if (active?.ready) {
      return `Installed release ${active.releaseId.slice(0, 12)} verified: ${active.maps.length} packaged maps, ${size(active.totalBytes)}. ${navigator.onLine ? "Online" : "Network offline"}.`;
    }
    if (active || staged) {
      return "Installed content is missing or corrupt. NOT offline-ready; see named missing resources below.";
    }
    if (this.state?.partial) {
      return `Interrupted/partial download: ${size(this.state.partial.completedBytes)} / ${size(this.state.partial.totalBytes)}. NOT ready. Resume while online.`;
    }
    return "Not installed. Online demand caching is partial, not offline readiness. Download the complete selected catalog and app shell.";
  }
  storageText() {
    const storage = this.storage;
    const lines = [
      "Download includes every resource reachable from the published catalog, not every map in the original game. Activation reloads all gameplay code and data together; other open tabs retain their version.",
    ];
    if (this.available) {
      lines.push(
        `Published release: ${this.available.releaseId.slice(0, 12)}, ${size(this.available.totalBytes)}.`,
      );
    }
    lines.push(
      this.state?.pinnedReleaseId
        ? `This tab is pinned to ${this.state.pinnedReleaseId.slice(0, 12)}.`
        : "This tab is not release-pinned; use the installed-release reload control before going offline.",
    );
    if (!storage?.supported) {
      lines.push(
        "Storage estimate/persistence unavailable; quota may still reject download.",
      );
    } else {
      lines.push(
        storage.persisted
          ? "Persistent storage granted."
          : "Persistent storage not granted. Browser eviction remains possible; use Verify before relying on offline readiness.",
      );
      if (Number.isFinite(storage.quota)) {
        lines.push(
          `Origin storage: ${size(storage.usage)} used / ${size(storage.quota)} quota. Updating keeps the prior release and needs a second complete copy plus overhead.`,
        );
      }
    }
    if (this.registration?.waiting) {
      lines.push(
        "A delivery-worker update is waiting. Close all tabs after activating the release to allow the browser to update it safely.",
      );
    }
    return lines.join("\n");
  }
  renderContent() {
    const active = this.state?.active;
    const staged = this.state?.staged;
    const manifest = staged ?? active ?? this.available;
    const lines = [];
    appendManifestContent(lines, manifest);
    appendMissingContent(lines, active, "Installed release missing/corrupt:");
    appendMissingContent(lines, staged, "Staged release missing/corrupt:");
    appendMissingContent(
      lines,
      this.state?.partial,
      "Partial download missing/corrupt:",
    );
    lines.push("Uncached requests:");
    for (const entry of this.state?.uncached ?? []) lines.push(entry);
    for (const entry of this.uncached) lines.push(entry);
    this.content.textContent = lines.join("\n");
  }
  destroy() {
    this.destroyed = true;
    this.listeners.abort();
    for (const request of this.requests) {
      clearTimeout(request.timer);
      request.channel.port1.close();
      request.reject(new DOMException("Offline panel destroyed", "AbortError"));
    }
    this.requests.clear();
    this.manifestLink?.remove();
    this.root.remove();
    // Downloads are worker-owned and survive panel/page closure; only explicit Cancel aborts.
  }
}

/** Main calls this before Network construction; failure stays visible without blocking gameplay. */
export async function initializeOfflineDelivery(
  parent = document.querySelector("aside"),
) {
  if (!(parent instanceof HTMLElement)) {
    throw new Error("Offline delivery requires a sidebar element");
  }
  const owner = new OfflineDelivery(parent);
  await owner.initialize();
  return owner;
}
