import { initializeInspectionTheme } from "./inspection-theme.js";

const MAX_INSPECTED_ENTITIES = 16384;
const MAX_ENTITY_OPTIONS = 200;

/** DOM controls are inspection policy, not original game UI. */
class Controls {
  constructor(api) {
    this.api = api;
    this.controller = new AbortController();
    this.options = { signal: this.controller.signal };
    this.entitySelect = document.querySelector("#entity");
    this.actionSelect = document.querySelector("#action");
    this.entityInputs = document.querySelectorAll(
      "#entity, #action, #visible, #entity-focus, .inspection-chrome [data-layer]",
    );
    this.lastMap = null;
    this.lastEntities = [];
    initializeInspectionTheme(this.controller.signal);
    this.bindPlayer();
    this.bindEntity();
    this.bindCamera();
  }
  report(error) {
    if (error.name === "AbortError") return;
    document.querySelector("#error").textContent = error.message;
    document.querySelector("#error").hidden = false;
  }
  invoke(work) {
    try {
      const result = work();
      if (result?.catch) result.catch(this.report);
    } catch (error) {
      this.report(error);
    }
  }
  listen(selector, event, handler) {
    document
      .querySelector(selector)
      .addEventListener(event, handler, this.options);
  }
  bindPlayer() {
    const api = this.api;
    this.listen("#pause", "click", () => api.pause(!api.snapshot().paused));
    this.listen("#input-config", "click", () =>
      this.invoke(() => api.onKeyConfig()),
    );
    this.listen("#step", "click", () =>
      this.invoke(() => {
        api.pause(true);
        api.step(Number(document.querySelector("#step-ms").value));
      }),
    );
    this.listen("#reload", "click", () => this.invoke(() => api.reload()));
    this.listen("#map", "change", (event) =>
      this.invoke(() => api.switchMap(event.target.value)),
    );
    this.listen("#debug", "change", (event) =>
      this.invoke(() => api.setDebug(event.target.checked)),
    );
    this.listen("#hitbox-reference", "change", (event) =>
      this.invoke(() => api.setGeometryReference(event.target.value)),
    );
    this.listen("#follow", "change", (event) =>
      api.setFollow(event.target.checked),
    );
    this.listen("#camera-reset", "click", () => api.setFollow(true));
  }
  bindEntity() {
    this.listen("#entity", "change", () => this.entityChanged());
    this.listen("#entity-search", "input", () =>
      this.invoke(() => this.filterEntities(this.api.snapshot().entities)),
    );
    this.listen("#entity-focus", "click", () =>
      this.invoke(() => {
        const entity = this.api
          .snapshot()
          .entities.find((value) => value.id === this.entitySelect.value);
        if (!entity) {
          throw new Error("Select an entity before centering the camera");
        }
        this.api.setCamera(entity.x, entity.y);
      }),
    );
    this.listen("#action", "change", () =>
      this.invoke(() =>
        this.api.setAction(this.entitySelect.value, this.actionSelect.value),
      ),
    );
    this.listen("#visible", "change", (event) =>
      this.invoke(() =>
        this.api.setVisible(this.entitySelect.value, event.target.checked),
      ),
    );
    for (const button of document.querySelectorAll("[data-layer]")) {
      button.addEventListener(
        "click",
        () => {
          this.invoke(() => {
            const entities = this.api.snapshot().entities;
            if (!entities.length || entities.length > MAX_INSPECTED_ENTITIES) {
              throw new Error(
                "Entity list is empty or exceeds inspection budget",
              );
            }
            let depth = entities[0].z;
            for (const entity of entities) {
              depth =
                button.dataset.layer === "front"
                  ? Math.max(depth, entity.z)
                  : Math.min(depth, entity.z);
            }
            depth += button.dataset.layer === "front" ? 1 : -1;
            this.api.setLayer(this.entitySelect.value, depth);
            this.entityChanged();
          });
        },
        this.options,
      );
    }
  }
  bindCamera() {
    for (const button of document.querySelectorAll("[data-camera]")) {
      button.addEventListener(
        "click",
        () => {
          const camera = this.api.snapshot().camera;
          const delta = button.dataset.camera.split(",").map(Number);
          this.invoke(() =>
            this.api.setCamera(camera.x + delta[0], camera.y + delta[1]),
          );
        },
        this.options,
      );
    }
  }
  entityChanged() {
    const entity = this.api
      .snapshot()
      .entities.find((value) => value.id === this.entitySelect.value);
    this.setEntityAvailability(Boolean(entity));
    if (!entity) {
      this.actionSelect.replaceChildren();
      document.querySelector("#layer-value").value = "—";
      return;
    }
    this.actionSelect.replaceChildren(
      ...entity.actions.map((name) => new Option(name, name)),
    );
    this.actionSelect.value = entity.action;
    document.querySelector("#visible").checked = entity.visible;
    document.querySelector("#layer-value").value = entity.z;
  }
  setEntityAvailability(available) {
    for (const input of this.entityInputs) {
      input.disabled = !available;
    }
  }

  /** Search one bounded snapshot; cap DOM rows explicitly and ask users to refine. */
  filterEntities(entities) {
    if (entities.length > MAX_INSPECTED_ENTITIES) {
      throw new Error(
        `Entity inspection exceeds ${MAX_INSPECTED_ENTITIES} records`,
      );
    }
    const query = document
      .querySelector("#entity-search")
      .value.trim()
      .toLowerCase();
    const selected = this.entitySelect.value;
    this.entitySelect.replaceChildren();
    let matched = 0;
    for (const entity of entities) {
      if (!`${entity.kind} ${entity.id}`.toLowerCase().includes(query)) {
        continue;
      }
      matched++;
      if (matched <= MAX_ENTITY_OPTIONS) {
        this.entitySelect.add(
          new Option(`${entity.kind} · ${entity.id}`, entity.id),
        );
      }
    }
    for (const option of this.entitySelect.options) {
      if (option.value === selected) this.entitySelect.value = selected;
    }
    document.querySelector("#entity-search-status").textContent =
      matched > MAX_ENTITY_OPTIONS
        ? `${matched} matches; showing first ${MAX_ENTITY_OPTIONS}. Refine the search to reach remaining entities.`
        : `${matched} matching entities. Preview changes are session-only.`;
    this.entityChanged();
  }
  refresh(snapshot) {
    if (snapshot.currentMap !== this.lastMap) {
      this.lastMap = snapshot.currentMap;
      document
        .querySelector("#map")
        .replaceChildren(...snapshot.maps.map((id) => new Option(id, id)));
      document.querySelector("#map").value = this.lastMap;
    }
    let changed = snapshot.entities.length !== this.lastEntities.length;
    if (snapshot.entities.length > MAX_INSPECTED_ENTITIES) {
      this.report(
        new Error(
          `Entity inspection exceeds ${MAX_INSPECTED_ENTITIES} records`,
        ),
      );
      this.setEntityAvailability(false);
      return;
    }
    for (let index = 0; index < snapshot.entities.length && !changed; index++) {
      changed = snapshot.entities[index].id !== this.lastEntities[index];
    }
    if (changed) {
      this.lastEntities = snapshot.entities.map((entity) => entity.id);
      this.filterEntities(snapshot.entities);
    }
    updateReadouts(snapshot);
    this.setEntityAvailability(
      Boolean(this.entitySelect.value) && !snapshot.loading,
    );
  }
  destroy() {
    this.controller.abort();
  }
}
export function createControls(api) {
  return new Controls(api);
}

function updateReadouts(snapshot) {
  document.querySelector("#scene-controls").disabled = !snapshot.currentMap;
  document.querySelector("#input-config").disabled = !snapshot.currentMap;
  document.querySelector("#step").disabled =
    !snapshot.currentMap || snapshot.loading;
  for (const id of ["entity", "action", "visible"]) {
    document.querySelector(`#${id}`).disabled = !snapshot.currentMap;
  }
  document.querySelector("#pause").textContent = snapshot.paused
    ? "Resume"
    : "Pause";
  document
    .querySelector("#pause")
    .setAttribute("aria-pressed", String(snapshot.paused));
  document.querySelector("#follow").checked = snapshot.follow;
  document.querySelector("#camera-position").value = snapshot.camera
    ? `${snapshot.camera.x.toFixed(0)}, ${snapshot.camera.y.toFixed(0)}`
    : "—";
  updateSettings(snapshot);
  document.querySelector("#status").value = snapshot.loading
    ? "Streaming map replacement; current scene retained, gameplay paused…"
    : `${snapshot.currentMap || "No map"} · ${snapshot.entities.length} entities · ${snapshot.pendingLoads} region loads`;
}
function updateSettings(snapshot) {
  const settings = {
    effective: snapshot.simulation?.effectiveSettings,
    diagnostics: snapshot.simulation?.diagnostics,
    streaming: snapshot.streaming,
  };
  document.querySelector("#settings").textContent = JSON.stringify(
    settings,
    null,
    2,
  );
  document.querySelector("#physics-status").textContent = snapshot.simulation
    ? `Physics coverage: ${JSON.stringify(snapshot.simulation.blocked)}. Artwork unavailable: ${snapshot.actorArtworkUnsupported || "none for current action"}.`
    : "Waiting for physics coverage…";
}
