import { LoadingDecoration } from "../delivery/loading-decoration.js";

/** Browser-only loading presentation; tokens own real async preparation, never progress. */
export class OnlineLoading {
  constructor(viewport, signal) {
    this.owners = new Set();
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
    viewport.append(this.overlay);
    signal.addEventListener("abort", () => this.destroy(), { once: true });
  }

  begin(message) {
    const owner = { message };
    this.owners.add(owner);
    this.status.textContent = message;
    this.overlay.hidden = false;
    return owner;
  }

  end(owner) {
    this.owners.delete(owner);
    this.overlay.hidden = this.owners.size === 0;
    for (const pending of this.owners) {
      this.status.textContent = pending.message;
    }
  }

  destroy() {
    this.owners.clear();
    this.overlay.remove();
  }
}
