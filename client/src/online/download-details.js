/** Shared labels for map preparation and the optional background download window. */
export function assetLabel(url) {
  if (!url) return "Preparing artwork…";
  const kind = url.includes("/audio/")
    ? "Music / sound"
    : url.includes("/atlases/")
      ? "Map / monster artwork"
      : url.includes("/regions/")
        ? "Map scenery"
        : url.includes("/maps/")
          ? "Map layout"
          : "Game artwork";
  return `${kind} · ${url.split("/").at(-1).slice(0, 18)}…`;
}

/**
 * The project-bar symbol reports activity only; the dialog carries the detail.
 * @param {{status?: string, paused?: boolean}|null} state Background download state.
 * @param {boolean} active Whether a foreground resource token is in flight.
 * @param {string} title Human name of the current resource or region.
 * @returns {{phase: string, label: string}} Symbol phase and accessible description.
 */
export function indicatorPresentation(state, active, title) {
  const status = state?.status ?? (active ? "downloading" : "idle");
  const phase = state?.paused ? "paused" : status;
  const hint = "Show download details";
  switch (phase) {
    case "complete":
      return { phase, label: `Downloads complete. ${hint}` };
    case "paused":
      return { phase, label: `Downloads paused. ${hint}` };
    case "failed":
      return { phase, label: `Downloads stopped. ${hint}` };
    case "cache-unavailable":
    case "storage-full":
      return { phase, label: `Downloads unavailable. ${hint}` };
    case "downloading":
      return { phase, label: `Downloading ${title}. ${hint}` };
    default:
      return { phase, label: `${title}. ${hint}` };
  }
}

function element(tag, className, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function bar() {
  const root = element("div", "download-progress");
  root.setAttribute("role", "progressbar");
  root.setAttribute("aria-label", "Files saved for this region");
  const fill = element("div", "download-fill");
  root.append(fill);
  return { root, fill };
}

/** Native dialog owns focus; downloading continues when the details window closes. */
export class DownloadDetails {
  constructor(viewport, formatBytes) {
    this.formatBytes = formatBytes;
    this.state = null;
    this.visible = false;
    this.timer = null;
    this.indicator = element("button", "download-indicator");
    this.indicator.id = "asset-loading";
    this.indicator.type = "button";
    this.indicator.hidden = true;
    this.indicator.setAttribute("aria-haspopup", "dialog");
    this.dialog = element("dialog", "download-dialog");
    this.dialog.setAttribute("aria-label", "Game downloads");
    this.buildDialog();
    this.indicator.addEventListener("click", () => {
      this.onOpen?.();
      this.dialog.showModal();
    });
    this.dialog.addEventListener("close", () => this.onClose?.());
    this.mount(viewport);
  }
  /**
   * The activity symbol sits to the left of the project-bar ping; the dialog stays
   * with the viewport so its top layer is never clipped by the bar's layout.
   * @param {Element} viewport Game viewport that hosts the modal dialog.
   */
  mount(viewport) {
    const ping = document.querySelector("#project-ping");
    if (ping) {
      ping.before(this.indicator);
    } else {
      this.indicator.dataset.host = "viewport";
      viewport.append(this.indicator);
    }
    viewport.append(this.dialog);
  }
  buildDialog() {
    const titlebar = element("div", "download-titlebar", "Game downloads");
    const close = element("button", "download-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close download details");
    close.addEventListener("click", () => this.dialog.close());
    titlebar.append(close);
    const body = element("div", "download-body");
    this.heading = element("strong", "download-heading");
    this.largeBar = bar();
    this.detail = element("p", "download-detail");
    this.current = element("p", "download-current");
    this.storage = element("p", "download-storage");
    this.queued = element("p", "download-queued");
    this.toggle = element("button", "download-toggle", "Pause downloads");
    this.toggle.type = "button";
    this.toggle.addEventListener("click", () => this.onToggle?.());
    const hint = element(
      "p",
      "download-hint",
      "You can keep playing. The current map loads first. Saved files are checked by hash and reused next time.",
    );
    body.append(
      this.heading,
      this.largeBar.root,
      this.detail,
      this.current,
      this.storage,
      this.queued,
      hint,
      this.toggle,
    );
    this.dialog.append(titlebar, body);
  }
  background(state) {
    const unchanged =
      this.state?.status === state.status && this.state?.name === state.name;
    this.state = state;
    if (unchanged && state.status === "complete") return;
    this.visible = true;
    clearTimeout(this.timer);
    if (state.status === "complete") {
      this.timer = setTimeout(() => {
        this.visible = false;
        this.onRefresh?.();
      }, 8000);
    }
  }
  update(foreground) {
    const state = this.state;
    const title = foreground.active
      ? assetLabel(foreground.current)
      : state
        ? state.name
        : "Loading game files…";
    const detail = this.describe(state);
    this.heading.textContent = state?.maps
      ? `${state.name} · ${state.maps} maps`
      : "Current map";
    this.detail.textContent = detail || foreground.count;
    this.current.textContent =
      (state?.current ?? []).join("\n") ||
      (foreground.active ? assetLabel(foreground.current) : "");
    this.updateStorage(state);
    this.updateBar(this.largeBar, state);
    const { phase, label } = indicatorPresentation(
      state,
      foreground.active,
      title,
    );
    this.indicator.dataset.state = phase;
    this.indicator.setAttribute("aria-label", label);
    this.indicator.title = label;
  }
  updateStorage(state) {
    this.storage.textContent = state?.cacheLimit
      ? `Browser cache: ${this.formatBytes(state.cacheBytes)} of ${this.formatBytes(state.cacheLimit)}`
      : "";
    this.queued.textContent = state?.queuedRegions?.length
      ? `Next: ${state.queuedRegions.join(", ")}`
      : "";
    this.toggle.hidden = !state || state.status !== "downloading";
    this.toggle.textContent = state?.paused
      ? "Resume downloads"
      : "Pause downloads";
  }
  describe(state) {
    if (!state) return "";
    if (state.status === "cache-unavailable") {
      return "Browser storage is unavailable. Assets load as needed.";
    }
    if (state.status === "storage-full") {
      return "Not enough browser storage for this region. Assets load as needed.";
    }
    if (state.status === "failed") return `Download stopped: ${state.error}`;
    const verb = state.paused
      ? "Paused"
      : state.status === "complete"
        ? "Saved"
        : "Saving";
    return `${verb} ${state.complete} / ${state.files} files${downloadCountText(state)} · ${this.formatBytes(state.doneBytes)} / ${this.formatBytes(state.bytes)}`;
  }
  updateBar(target, state) {
    const percent = state?.bytes
      ? Math.min(100, (100 * state.doneBytes) / state.bytes)
      : 0;
    target.fill.style.width = `${percent.toFixed(1)}%`;
    target.root.setAttribute("aria-valuenow", String(Math.round(percent)));
    target.root.setAttribute("aria-valuemin", "0");
    target.root.setAttribute("aria-valuemax", "100");
    target.root.hidden = !state?.bytes;
  }
  destroy() {
    clearTimeout(this.timer);
    this.dialog.close();
    this.dialog.remove();
    this.indicator.remove();
  }
}

/**
 * Members are cache entries, not transfers: one packed or shared container can
 * save hundreds of requests. Only say so when the two counts really differ.
 */
export function downloadCountText(state) {
  return Number.isInteger(state?.downloads) && state.downloads < state.files
    ? ` (${state.downloads} downloads)`
    : "";
}
