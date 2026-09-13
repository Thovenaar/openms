/** Explicit destinations chosen by the world release; travel remains a server-owned command. */
export class CommunityMaps {
  constructor(catalog, { intent, clearInput, signal }) {
    this.host = document.createElement("div");
    this.host.className = "community-maps";
    this.host.hidden = true;
    const maps = catalog.communityMaps ?? [];
    this.available = maps.length > 0;
    const label = document.createElement("label");
    label.textContent = "Community maps ";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Community map");
    for (const map of maps) {
      const option = document.createElement("option");
      option.value = String(map.id);
      option.textContent = map.name;
      select.append(option);
    }
    label.append(select);
    const enter = document.createElement("button");
    enter.textContent = "Enter map";
    enter.addEventListener(
      "click",
      () => {
        clearInput();
        intent({ kind: "content.enter", mapId: Number(select.value) });
      },
      { signal },
    );
    for (const type of ["keydown", "keyup", "pointerdown"]) {
      this.host.addEventListener(type, (event) => event.stopPropagation(), {
        signal,
      });
    }
    this.host.append(label, enter);
    document.body.append(this.host);
    signal.addEventListener("abort", () => this.host.remove(), { once: true });
  }

  update(status) {
    this.host.hidden = !this.available || status !== "active";
  }
}
