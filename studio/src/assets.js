import { element, input, select, button, empty } from "./dom.js";

/** Search selection is metadata; every preview/base placement resolves its original ID. */
export class AssetBrowser {
  constructor(host, api, choose, error) {
    this.api = api;
    this.choose = choose;
    this.error = error;
    this.kind = "mob";
    this.query = "";
    this.mapId = "100000000";
    this.offset = 0;
    this.generation = 0;
    this.results = element("div", { class: "asset-results" });
    this.summary = element("p", {
      class: "hint",
      text: "Search the original collection.",
    });
    this.controls(host);
  }

  controls(host) {
    const search = input(
      "",
      (value) => {
        this.query = value;
      },
      { placeholder: "Search by name or ID", "aria-label": "Search assets" },
    );
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.search(true);
    });
    host.append(
      element("h2", { text: "Asset library" }),
      element("p", {
        class: "hint",
        text: "Original artwork. New possibilities.",
      }),
      select(
        this.kind,
        [
          ["mob", "Mobs"],
          ["map", "Maps"],
          ["entity", "Scenery in a map"],
          ["item", "Items"],
          ["quest", "Quests"],
          ["sound", "Sounds"],
          ["bundle", "UI bundles"],
        ],
        (kind) => {
          this.kind = kind;
          this.search(true);
        },
      ),
      search,
      button("Search", () => this.search(true)),
      this.summary,
      this.results,
      element("div", { class: "pagination" }, [
        button("← Previous", () => {
          this.offset = Math.max(0, this.offset - 20);
          this.search();
        }),
        button("Next →", () => {
          this.offset += 20;
          this.search();
        }),
      ]),
    );
  }

  async search(reset = false) {
    if (reset) this.offset = 0;
    const generation = ++this.generation;
    this.results.replaceChildren(
      element("p", { class: "hint", text: "Looking through the collection…" }),
    );
    try {
      const result =
        this.kind === "entity"
          ? await this.api.post("assets/scene", {
              buildId: this.api.config.assetBuildId,
              query: { mapId: this.mapId, offset: this.offset, limit: 20 },
            })
          : await this.api.post("assets/search", {
              buildId: this.api.config.assetBuildId,
              query: {
                kind: this.kind,
                query: this.query,
                offset: this.offset,
                limit: 20,
              },
            });
      if (generation !== this.generation) return;
      this.summary.textContent =
        this.kind === "entity"
          ? `Scenery from map ${this.mapId}`
          : `${result.total} assets · ${this.offset + 1}–${this.offset + result.matches.length}`;
      this.results.replaceChildren(
        ...result.matches.map((row) => this.card(row)),
      );
      if (!result.matches.length) {
        this.results.append(
          empty("No matches", "Try a different name or asset ID."),
        );
      }
    } catch (error) {
      if (generation === this.generation) this.error(error);
    }
  }

  card(row) {
    const glyphs = {
      map: "▧",
      mob: "♟",
      entity: "✦",
      quest: "◇",
      item: "◈",
      sound: "♫",
      bundle: "▦",
    };
    return element(
      "button",
      { class: "asset-card", type: "button", onclick: () => this.choose(row) },
      [
        element("span", {
          class: `asset-glyph ${row.kind}`,
          text: glyphs[row.kind],
        }),
        element("span", { class: "asset-label" }, [
          element("strong", { text: row.name }),
          element("small", { text: row.id }),
        ]),
        element("span", { class: "asset-arrow", text: "↗" }),
      ],
    );
  }
}
