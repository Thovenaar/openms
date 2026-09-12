import {
  DELIVERY_LIMITS,
  boundedResponse,
  validateRelease,
} from "../../public/offline-manifest.js";
import { Gate, check } from "../rendering/stream-network.js";
import { LoadingDecoration } from "./loading-decoration.js";

const REQUEST_TIMEOUT_MS = 120000;
const MAX_UNCACHED = 65536;
const UPDATE_TIMEOUT_MS = 30000;
const RELOAD_KEY = "maple-delivery-startup-reload";

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

/** An installing worker must finish before asking it to take over the controller. */
async function finishWorkerInstallation(worker) {
  if (!worker || worker.state === "installed" || worker.state === "activated") {
    return;
  }
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", changed);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (worker.state === "installed" || worker.state === "activated") {
        finish();
      } else if (worker.state === "redundant") {
        finish(new Error("Delivery worker installation failed"));
      }
    };
    const timer = setTimeout(
      () => finish(new Error("Delivery worker installation timed out")),
      UPDATE_TIMEOUT_MS,
    );
    worker.addEventListener("statechange", changed);
    changed();
  });
}

/** A native browser sidebar, explicitly separate from recovered game UI artwork. */
export class OfflineDelivery {
  constructor(parent, selectMap) {
    this.selectMap = selectMap;
    this.mapGate = new Gate(1);
    this.map = null;
    this.preparedMap = null;
    this.unpublished = null;
    this.mapLoading = false;
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
    this.launchReady = false;
    this.startupStatus = "Checking for game updates…";
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    this.createStartupOverlay();
    this.root = node("fieldset", "", parent);
    this.root.id = "offline-delivery";
    node("legend", "Offline download · local browser policy", this.root);
    this.summary = node("p", "Checking offline support…", this.root);
    this.summary.setAttribute("role", "status");
    this.progress = node("progress", "", this.root);
    this.progress.hidden = true;
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
      "Verify current map / check update",
      this.root,
      () => this.run("refresh"),
    );
    this.errors = node("p", "", this.root);
    this.errors.setAttribute("role", "alert");
    const content = node("details", "", this.root);
    node("summary", "Technical details and packaged content", content);
    this.details = node("p", "", content);
    this.details.className = "hint";
    this.content = node("pre", "", content);
    this.content.style.whiteSpace = "pre-wrap";
  }
  /** Minimal browser-owned status; progress comes only from verified file counts. */
  createStartupOverlay() {
    const viewport = document.querySelector("#viewport") ?? document.body;
    this.overlay = node("section", "", viewport);
    this.overlay.id = "delivery-startup";
    this.overlay.setAttribute("aria-label", "Loading game files");
    const card = node("div", "", this.overlay);
    card.className = "delivery-card";
    this.loadingDecoration = new LoadingDecoration(card, this.listeners.signal);
    this.overlayStatus = node("p", "Loading files…", card);
    this.overlayStatus.className = "delivery-status";
    this.overlayStatus.setAttribute("role", "status");
    this.overlayStatus.setAttribute("aria-atomic", "true");
    this.overlayProgress = node("progress", "", card);
    this.overlayProgress.setAttribute("aria-label", "Game files loaded");
    this.overlayDetail = node("p", this.startupStatus, card);
    this.overlayDetail.className = "delivery-hint";
    this.overlayDiagnostics = node("details", "", card);
    node("summary", "Technical details", this.overlayDiagnostics);
    this.overlayDiagnosticText = node("pre", "", this.overlayDiagnostics);
    this.retryButton = button("Try again", card, () => {
      sessionStorage.removeItem(RELOAD_KEY);
      this.run("startup");
    });
    this.retryButton.hidden = true;
  }
  async initialize() {
    if (
      !window.isSecureContext ||
      !("serviceWorker" in navigator) ||
      !("caches" in window)
    ) {
      throw new Error(
        "Verified startup requires CacheStorage and service workers on localhost or HTTPS.",
      );
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
      await this.prepareStartup();
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
    if (!this.launchReady && !this.busy && navigator.onLine) {
      this.run("startup");
    }
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
      if (action === "startup" && !this.registration?.active) {
        await this.initialize();
      } else if (action === "startup") await this.prepareStartup();
      else if (action === "download") await this.download();
      else if (action === "cancel") await this.cancel();
      else if (action === "activate") await this.activate();
      else if (action === "refresh") await this.refresh();
    } catch (error) {
      this.error = error.message;
    }
    this.render();
  }
  /** Proposed descriptors are checked against the pinned release; only its sources are fetched. */
  request(type, releaseId = null, options = {}) {
    if (this.destroyed) {
      return Promise.reject(new Error("Offline panel destroyed"));
    }
    const worker =
      navigator.serviceWorker.controller ?? this.registration?.active;
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
            this.verification = null;
          } else this.verification = event.data.progress;
          this.render();
        } else if (event.data.type === "ERROR") {
          finish(new Error(event.data.error));
        } else finish(null, event.data.result);
      };
      this.requests.add(request);
      worker.postMessage({ type, releaseId, ...options }, [channel.port2]);
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
  /** Only a failed transport permits offline play; HTTP/hash/JSON failures block. */
  async checkAvailable() {
    this.available = null;
    let bytes;
    const signal = AbortSignal.any([
      this.listeners.signal,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ]);
    try {
      const response = await fetch("/generated/release.json", {
        cache: "no-store",
        redirect: "manual",
        signal,
      });
      bytes = await boundedResponse(response, DELIVERY_LIMITS.manifestBytes);
    } catch (error) {
      if (this.destroyed) throw error;
      if (
        error instanceof TypeError ||
        error.name === "TimeoutError" ||
        (error.name === "AbortError" && signal.reason?.name === "TimeoutError")
      ) {
        this.error = `Server unavailable: ${error.message}. Only verified installed content may start.`;
        return false;
      }
      throw error;
    }
    this.available = await validateRelease(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    this.loadingDecoration.load(this.available);
    return true;
  }
  /** Match the executing shell, then verify only the saved map before allowing play. */
  async prepareStartup() {
    if (this.busy || this.destroyed || this.launchReady) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await this.retryPublication();
      const online = await this.checkAvailable();
      if (online) await this.updateWorker(this.available.releaseId);
      this.state = await this.request("OFFLINE_STATUS");
      if (!online) {
        this.loadingDecoration.load(this.state.pinned ?? this.state.active);
      }
      await this.measureStorage();
      const selected = online
        ? await this.installLatest()
        : this.offlineSelection();
      if (
        this.state.pinnedReleaseId !== selected.releaseId ||
        this.state.pinned?.ready === false
      ) {
        this.reloadSelected(selected.releaseId);
        return;
      }
      const { mapId, resources } = await this.selectMap();
      const prepared = await this.loadMap(
        mapId,
        !online,
        resources,
        crypto.randomUUID(),
      );
      await this.commitMap(mapId, prepared.preparationId);
      sessionStorage.removeItem(RELOAD_KEY);
      this.launchReady = true;
      this.resolveReady({
        releaseId: selected.releaseId,
        mapId,
        offline: !online,
      });
    } finally {
      this.busy = false;
      this.render();
    }
  }
  /** Updating the controller preserves every tab's immutable content binding. */
  async updateWorker(id) {
    if (this.state?.active?.releaseId === id && !this.registration.waiting) {
      return;
    }
    await this.registration.update();
    await finishWorkerInstallation(this.registration.installing);
    const waiting = this.registration.waiting;
    if (!waiting) return;
    await new Promise((resolve, reject) => {
      const workers = navigator.serviceWorker;
      const changed = () => {
        if (workers.controller !== waiting) return;
        clearTimeout(timer);
        workers.removeEventListener("controllerchange", changed);
        resolve();
      };
      const timer = setTimeout(() => {
        workers.removeEventListener("controllerchange", changed);
        reject(
          new Error(
            "Delivery worker takeover timed out. Close other game tabs and retry.",
          ),
        );
      }, UPDATE_TIMEOUT_MS);
      workers.addEventListener("controllerchange", changed);
      waiting.postMessage({ type: "USE_DELIVERY_WORKER" });
      changed();
    });
  }
  async installLatest() {
    const id = this.available.releaseId;
    this.startupStatus = "Preparing the game and checking saved files…";
    const result = await this.request("PREPARE_RELEASE", id);
    if (!result.ready) {
      throw new Error(
        "Source preparation was cancelled. Retry before playing.",
      );
    }
    this.state = await this.request("OFFLINE_STATUS");
    return result;
  }
  offlineSelection() {
    const pinned =
      this.state.pinned ??
      (this.state.active?.releaseId === this.state.pinnedReleaseId
        ? this.state.active
        : null);
    if (pinned?.ready) return pinned;
    if (this.state.active?.ready) return this.state.active;
    throw new Error(
      "Server unavailable and no verified game source is installed. Reconnect and retry.",
    );
  }
  reloadSelected(id) {
    if (sessionStorage.getItem(RELOAD_KEY) === id) {
      throw new Error(
        "The verified release could not control this tab after reload. Close other game tabs, then retry.",
      );
    }
    sessionStorage.setItem(RELOAD_KEY, id);
    this.startupStatus = "Opening the updated game…";
    window.location.reload();
  }
  /** The caller supplies its actual selected profile roots, never a whole optional catalog. */
  async loadMap(mapId, offline, resources, preparationId) {
    if (this.unpublished) {
      throw new Error("Retry the committed world's offline publication first");
    }
    this.startupStatus = this.mapLoading
      ? "Preparing your destination and checking saved files…"
      : "Preparing your saved map and checking game files…";
    this.render();
    const result = await this.request(
      "PREPARE_MAP",
      this.state.pinnedReleaseId,
      { mapId, offline, resources, preparationId },
    );
    if (!result.ready) {
      throw new Error(`Map ${mapId} preparation was cancelled.`);
    }
    this.preparedMap = result;
    return result;
  }
  /** Call after world adoption; a rejection reports cache publication, not world rollback. */
  commitMap(mapId, preparationId) {
    return this.mapGate.run(async () => {
      const result = await this.publish("COMMIT_MAP", {
        kind: "map",
        mapId,
        preparationId,
      });
      if (this.preparedMap?.preparationId === preparationId) {
        this.map = this.preparedMap;
        this.preparedMap = null;
      }
      this.render();
      return result;
    }, this.listeners.signal);
  }
  /** Discard can interrupt a matching worker preparation; stale tokens are harmless. */
  async discardMap(preparationId) {
    if (this.unpublished?.preparationId === preparationId) {
      return { discarded: false };
    }
    const result = await this.request(
      "DISCARD_MAP",
      this.state.pinnedReleaseId,
      { preparationId },
    );
    if (this.preparedMap?.preparationId === preparationId) {
      this.preparedMap = null;
    }
    return result;
  }
  prepareMap(mapId, signal, resources) {
    return this.mapGate.run(
      () => this.prepareOperation("map", resources, signal, mapId),
      signal,
    );
  }
  async prepareProfile(resources, signal) {
    const result = await this.mapGate.run(
      () => this.prepareOperation("profile", resources, signal),
      signal,
    );
    return result.preparationId;
  }
  commitProfile(token) {
    return this.mapGate.run(
      () =>
        this.publish("COMMIT_PROFILE", {
          kind: "profile",
          preparationId: token,
        }),
      this.listeners.signal,
    );
  }
  discardProfile(token) {
    if (this.unpublished?.preparationId === token) {
      return Promise.resolve({ discarded: false });
    }
    return this.request("DISCARD_PROFILE", this.state.pinnedReleaseId, {
      preparationId: token,
    });
  }
  async retainCurrentMap(token) {
    const result = await this.mapGate.run(
      () => this.request("RETAIN_MAP", this.state.pinnedReleaseId, { token }),
      this.listeners.signal,
    );
    return result.token;
  }
  releaseRetainedMap(token) {
    return this.mapGate.run(
      () =>
        this.request("RELEASE_RETAINED_MAP", this.state.pinnedReleaseId, {
          token,
        }),
      this.listeners.signal,
    );
  }
  async retryPublication() {
    const pending = this.unpublished;
    if (!pending) return;
    if (pending.kind === "map") {
      await this.commitMap(pending.mapId, pending.preparationId);
    } else {
      await this.commitProfile(pending.preparationId);
    }
  }
  async publish(command, pending) {
    if (typeof pending.preparationId !== "string") {
      throw new Error("A preparation token is required");
    }
    if (
      this.unpublished &&
      this.unpublished.preparationId !== pending.preparationId
    ) {
      throw new Error("Retry the committed world's offline publication first");
    }
    this.unpublished = pending;
    try {
      const result = await this.request(
        command,
        this.state.pinnedReleaseId,
        pending,
      );
      this.unpublished = null;
      return result;
    } catch (error) {
      this.error = error.message;
      throw error;
    }
  }
  async prepareOperation(kind, resources, signal, mapId) {
    if (this.unpublished) {
      throw new Error("Retry the committed world's offline publication first");
    }
    check(signal);
    if (this.busy) {
      throw new Error("An asset installation operation is already running");
    }
    if (!Array.isArray(resources)) {
      throw new Error("Selected profile resources are required");
    }
    const preparationId = crypto.randomUUID();
    const discard = () =>
      kind === "map"
        ? this.discardMap(preparationId)
        : this.discardProfile(preparationId);
    const abort = () => {
      discard().catch((error) => {
        this.error = error.message;
      });
    };
    this.busy = true;
    this.mapLoading = kind === "map";
    this.error = null;
    signal.addEventListener("abort", abort, { once: true });
    try {
      const result =
        kind === "map"
          ? await this.loadMap(
              mapId,
              !navigator.onLine,
              resources,
              preparationId,
            )
          : await this.request("PREPARE_PROFILE", this.state.pinnedReleaseId, {
              resources,
              preparationId,
              offline: !navigator.onLine,
            });
      check(signal);
      if (!result.ready) throw new Error("Profile preparation was cancelled");
      return result;
    } catch (error) {
      await discard();
      this.error = error.message;
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      this.busy = false;
      this.mapLoading = false;
      this.render();
    }
  }

  async refresh() {
    if (this.busy || this.destroyed) return this.snapshot();
    this.busy = true;
    this.render();
    try {
      this.error = null;
      await this.retryPublication();
      this.state = await this.request("OFFLINE_STATUS");
      await this.measureStorage();
      await this.checkAvailable();
    } finally {
      this.busy = false;
      this.render();
    }
    return this.snapshot();
  }
  async download() {
    if (this.busy) throw new Error("Offline operation already in progress");
    const id = this.available?.releaseId ?? this.state?.partial?.releaseId;
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
    if (staged?.ready && staged.complete) {
      await this.request("ACTIVATE_RELEASE", staged.releaseId);
    } else if (!this.state?.active?.ready) {
      throw new Error("No verified game source is available");
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
      launchReady: this.launchReady,
      startupStatus: this.startupStatus,
      map: this.map,
      mapLoading: this.mapLoading,
    };
  }
  render() {
    if (this.destroyed) return;
    const active = this.state?.active;
    const staged = this.state?.staged;
    const job = this.state?.job;
    this.summary.textContent = this.summaryText(active, staged, job);
    const progress = this.verification ?? job;
    this.progress.hidden = !progress;
    this.renderFileProgress(this.progress, progress);
    this.renderControls(active, staged, job);
    this.errors.textContent = this.error || this.state?.error || "";
    this.details.textContent = this.storageText();
    this.renderContent();
    this.renderStartup();
  }
  renderStartup() {
    const hidden = this.launchReady && !this.mapLoading;
    const failed = !this.busy && Boolean(this.error);
    const progress = this.verification ?? this.state?.job;
    this.overlay.hidden = hidden;
    this.overlay.dataset.state = failed ? "error" : "loading";
    this.overlayStatus.textContent = failed
      ? "Unable to load game files"
      : this.loadingText(progress);
    this.overlayDetail.textContent = failed
      ? "Required files could not be downloaded or verified. Check your connection and browser storage, then try again."
      : this.startupStatus;
    this.overlayDiagnosticText.textContent =
      this.error ||
      (progress
        ? `${size(progress.completedBytes)} / ${size(progress.totalBytes)}\n${progress.current}`
        : "");
    this.overlayDiagnostics.hidden = !this.overlayDiagnosticText.textContent;
    this.overlayProgress.hidden = !this.busy;
    this.renderFileProgress(this.overlayProgress, progress);
    this.retryButton.hidden = this.launchReady || this.busy || !this.error;
  }

  /** Counts describe verified files in the current worker scope, never all maps. */
  loadingText(progress) {
    if (Number.isInteger(progress?.totalEntries) && progress.totalEntries > 0) {
      return `Loading files (${progress.completedEntries}/${progress.totalEntries})`;
    }
    return "Loading files…";
  }

  renderFileProgress(element, progress) {
    if (Number.isInteger(progress?.totalEntries) && progress.totalEntries > 0) {
      element.max = progress.totalEntries;
      element.value = progress.completedEntries;
    } else {
      element.removeAttribute("value");
    }
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
    const launchable = (staged?.ready && staged.complete) || active?.ready;
    this.activateButton.disabled = this.busy || !launchable;
    this.checkButton.disabled =
      this.busy || Boolean(job) || !this.registration?.active;
  }
  summaryText(active, staged, job) {
    if (this.busy && !this.state) {
      return "Checking installation; offline readiness is not yet verified.";
    }
    if (this.verification) {
      return `${this.loadingText(this.verification)} · Checking saved files.`;
    }
    if (job) {
      return `${this.loadingText(job)} · Ready after verification.`;
    }
    return this.releaseSummary(active, staged);
  }

  releaseSummary(active, staged) {
    if (this.map?.ready) {
      return `Map ${this.map.mapId} verified: ${this.map.resources} resources, ${size(this.map.totalBytes)}. Other maps download when entered.`;
    }
    if (staged?.ready && staged.complete) {
      return "Complete release installed. Activation re-verifies the full release before switching.";
    }
    if (active?.ready) {
      return "Game files verified. Current map readiness is checked separately.";
    }
    if (active || staged) {
      return "Installed game source is missing or corrupt; see named resources below.";
    }
    return "Startup installs only the current map and shared game assets. Complete-release download is optional.";
  }
  storageText() {
    const storage = this.storage;
    const lines = [
      "Startup and travel verify only the selected map and shared startup assets. Disposable resources are evicted FIFO under quota pressure; current fields and complete installations are protected. Other maps download only when entered. Complete-release download remains an optional offline installation of every packaged map, and fails explicitly if it cannot fit.",
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
          `Origin storage: ${size(storage.usage)} used / ${size(storage.quota)} quota. Updates reuse matching resources while retaining the prior version; additional space depends on the selected content.`,
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
    this.overlay.remove();
    this.root.remove();
    // Downloads are worker-owned and survive panel/page closure; only explicit Cancel aborts.
  }
}

/** Main supplies the saved-map resolver and awaits owner.ready before creating the renderer. */
export async function initializeOfflineDelivery(parent, selectMap) {
  if (!(parent instanceof HTMLElement)) {
    throw new Error("Offline delivery requires a sidebar element");
  }
  if (typeof selectMap !== "function") {
    throw new Error("Offline delivery requires a saved-map resolver");
  }
  const owner = new OfflineDelivery(parent, selectMap);
  owner.initialize().catch((error) => {
    owner.error = error.message;
    owner.render();
  });
  return owner;
}
