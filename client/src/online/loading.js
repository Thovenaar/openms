import { LoadingDecoration } from "../delivery/loading-decoration.js";

/** Browser-only loading presentation; tokens own real async preparation, never progress. */
export class OnlineLoading {
  constructor(viewport, signal) {
    this.owners = new Set();
    this.maps = new Set();
    this.destroyed = false;
    this.overlay = document.createElement("section");
    this.overlay.id = "delivery-startup";
    this.overlay.hidden = true;
    this.overlay.setAttribute("aria-label", "Loading game files");
    const card = document.createElement("div");
    card.className = "delivery-card";
    this.decoration = new LoadingDecoration(card, signal);
    this.status = document.createElement("p");
    this.status.className = "delivery-status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-atomic", "true");
    card.append(this.status);
    this.overlay.append(card);
    this.indicator = document.createElement("div");
    this.indicator.id = "asset-loading";
    this.indicator.hidden = true;
    this.indicator.setAttribute("role", "status");
    this.indicator.setAttribute("aria-label", "Loading assets");
    this.indicator.title = "Loading assets";
    viewport.append(this.overlay, this.indicator);
    signal.addEventListener("abort", () => this.destroy(), { once: true });
  }

  /** Only an uncached download admitted during map preparation can cover the field. */
  beginMap(descriptor) {
    const owner = { downloading: false, urls: new Set([descriptor.url]) };
    this.maps.add(owner);
    return owner;
  }

  /** A validated manifest bounds the destination's exact static region/atlas dependencies. */
  includeMap(owner, manifest) {
    if (!owner) return;
    for (const resource of manifest.regions) owner.urls.add(resource.url);
    for (const resource of Object.values(manifest.atlases)) {
      owner.urls.add(resource.url);
    }
  }

  endMap(owner) {
    this.maps.delete(owner);
    this.refresh();
  }

  /** Download/decode tokens represent real asset work; resident cache hits create none. */
  begin(kind = "asset", url = null) {
    const owner = { kind };
    this.owners.add(owner);
    if (kind === "download") {
      const path = new URL(url, "https://assets.invalid").pathname;
      for (const map of this.maps) {
        if (map.urls.has(path)) map.downloading = true;
      }
    }
    this.refresh();
    return owner;
  }

  end(owner) {
    this.owners.delete(owner);
    this.refresh();
  }

  refresh() {
    if (this.destroyed) return;
    let fullscreen = false;
    for (const map of this.maps) fullscreen ||= map.downloading;
    this.overlay.hidden = !fullscreen;
    this.indicator.hidden = fullscreen || this.owners.size === 0;
    this.status.textContent = "Loading map assets…";
  }

  destroy() {
    this.destroyed = true;
    this.owners.clear();
    this.maps.clear();
    this.indicator.remove();
    this.overlay.remove();
  }
}
