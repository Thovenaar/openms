import { LIMITS } from "../rendering/stream-validation.js";

const MAX_INSPECTED_ENTITIES = 16384;
const MAX_ENTITY_OPTIONS = 200;
const MAX_MONSTER_CATALOG = 16384;
const MAX_MONSTER_OPTIONS = 200;

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
    this.monsters = null;
    this.spawnRequest = null;
    this.bindPlayer();
    this.bindEntity();
    this.bindCamera();
    this.bindMonsters();
  }
  invoke(work) {
    try {
      const result = work();
      if (result?.catch) result.catch((error) => this.api.onError(error));
    } catch (error) {
      this.api.onError(error);
    }
  }
  listen(selector, event, handler) {
    document
      .querySelector(selector)
      .addEventListener(event, handler, this.options);
  }
  bindPlayer() {
    const api = this.api;
    this.listen("#pause", "click", () =>
      this.invoke(() => api.pause(!api.snapshot().paused)),
    );
    this.listen("#input-config", "click", () =>
      this.invoke(() => api.onKeyConfig()),
    );
    this.listen("#step", "click", () =>
      this.invoke(async () => {
        await api.pause(true);
        await api.step(Number(document.querySelector("#step-ms").value));
      }),
    );
    this.listen("#reload", "click", () => this.invoke(() => api.reload()));
    this.listen("#map-search", "input", () =>
      this.invoke(() => this.filterMaps(this.api.snapshot())),
    );
    this.listen("#map-search-clear", "click", () =>
      this.invoke(() => {
        const search = document.querySelector("#map-search");
        search.value = "";
        this.filterMaps(this.api.snapshot());
        search.focus();
      }),
    );
    this.listen("#map", "change", (event) => {
      document.querySelector("#map-go").disabled =
        !event.target.value || this.api.snapshot().loading;
    });
    this.listen("#map-go", "click", () =>
      this.invoke(() => {
        const id = document.querySelector("#map").value;
        if (!id) throw new Error("Choose a matching map before pressing Go");
        return api.switchMap(id);
      }),
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

  bindMonsters() {
    this.listen("#mob-search", "input", () =>
      this.invoke(() => this.filterMonsters()),
    );
    this.listen("#mob-search-clear", "click", () =>
      this.invoke(() => {
        document.querySelector("#mob-search").value = "";
        this.filterMonsters();
        document.querySelector("#mob-search").focus();
      }),
    );
    this.listen("#mob-template", "change", () =>
      this.updateSpawnAvailability(this.api.snapshot()),
    );
    this.listen("#mob-spawn", "click", () =>
      this.invoke(() => this.spawnMonster()),
    );
  }

  /** One original catalog snapshot per build, with bounded search rows, not a scene clone. */
  loadMonsters(snapshot) {
    const entries = this.api.monsterCatalog();
    if (!Array.isArray(entries) || entries.length > MAX_MONSTER_CATALOG) {
      throw new Error("Original monster catalog exceeds the inspection bound.");
    }
    const seen = new Set();
    this.monsters = [];
    for (const entry of entries) {
      if (
        !Number.isSafeInteger(entry.id) ||
        entry.id <= 0 ||
        typeof entry.name !== "string" ||
        seen.has(entry.id)
      ) {
        throw new Error("Invalid original monster catalog identity.");
      }
      seen.add(entry.id);
      const label = `${entry.name || "Monster"} [${entry.id}]`;
      this.monsters.push({ id: entry.id, label, search: label.toLowerCase() });
    }
    this.monsterBuild = snapshot.buildId;
    this.filterMonsters();
  }

  filterMonsters() {
    if (!this.monsters) return;
    const search = document.querySelector("#mob-search");
    const query = search.value.trim().toLowerCase();
    const select = document.querySelector("#mob-template");
    const previous = select.value;
    select.replaceChildren();
    let matched = 0;
    for (const entry of this.monsters) {
      if (!entry.search.includes(query)) continue;
      matched++;
      if (matched <= MAX_MONSTER_OPTIONS) {
        select.add(new Option(entry.label, String(entry.id)));
      }
    }
    for (const option of select.options) {
      if (option.value === previous) select.value = previous;
    }
    select.disabled = matched === 0;
    document.querySelector("#mob-search-clear").disabled = query.length === 0;
    document.querySelector("#mob-search-status").textContent =
      matched > MAX_MONSTER_OPTIONS
        ? `${matched} matching original monsters; first ${MAX_MONSTER_OPTIONS} shown. Refine the name or ID.`
        : `${matched} of ${this.monsters.length} packaged original monsters match.`;
    this.updateSpawnAvailability(this.api.snapshot());
  }

  updateSpawnAvailability(snapshot) {
    const blocked =
      this.spawnRequest ||
      snapshot.loading ||
      snapshot.paused ||
      !snapshot.currentMap ||
      !snapshot.developmentSpawn?.available;
    document.querySelector("#mob-spawn").disabled =
      Boolean(blocked) || !document.querySelector("#mob-template").value;
    document.querySelector("#mob-spawn").textContent = this.spawnRequest
      ? "Preparing original monster…"
      : "Spawn selected monster";
    document.querySelector("#mob-admission-status").textContent =
      this.spawnAdmissionMessage(snapshot);
  }

  spawnAdmissionMessage(snapshot) {
    if (this.spawnRequest) {
      return "Preparing original artwork and gameplay resources before admission.";
    }
    if (snapshot.paused) return "Resume gameplay before spawning.";
    if (snapshot.loading) return "Wait for field loading to finish.";
    return (
      snapshot.developmentSpawn?.reason ||
      "Development-only spawn; the monster uses ordinary combat, drops and quest credit."
    );
  }

  ownsSpawnRequest(request) {
    return (
      !this.controller.signal.aborted &&
      this.api.snapshot().currentMap === request.map
    );
  }

  async spawnMonster() {
    const snapshot = this.api.snapshot();
    this.updateSpawnAvailability(snapshot);
    if (document.querySelector("#mob-spawn").disabled) return;
    const id = Number(document.querySelector("#mob-template").value);
    if (!this.monsters.some((entry) => entry.id === id)) {
      throw new Error("Choose a packaged original monster.");
    }
    const request = { map: snapshot.currentMap };
    this.spawnRequest = request;
    const status = document.querySelector("#mob-spawn-status");
    status.textContent = "";
    this.updateSpawnAvailability(snapshot);
    try {
      const result = await this.api.spawnMonster(id);
      if (!this.ownsSpawnRequest(request)) return;
      if (result?.ok !== true) {
        throw new Error(result?.reason || "Monster spawn rejected.");
      }
      status.textContent = `Spawned original monster ${id}. Combat, drops and quest credit follow the current authority's normal rules.`;
    } catch (error) {
      if (this.ownsSpawnRequest(request)) {
        status.textContent = `Spawn failed: ${error.message}`;
      }
    } finally {
      if (this.spawnRequest === request) this.spawnRequest = null;
      if (!this.controller.signal.aborted) {
        this.updateSpawnAvailability(this.api.snapshot());
      }
    }
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
  /** Inspector search never travels; only the explicit Go action invokes travel. */
  filterMaps(snapshot, selected = document.querySelector("#map").value) {
    if (snapshot.maps.length > LIMITS.maps) {
      throw new Error("Map inspection exceeds catalog budget");
    }
    const query = document
      .querySelector("#map-search")
      .value.trim()
      .toLowerCase();
    const select = document.querySelector("#map");
    select.replaceChildren();
    let matched = 0;
    for (const id of snapshot.maps) {
      const label = `${this.api.mapName(id)} [${id}]`;
      if (!label.toLowerCase().includes(query)) continue;
      matched++;
      select.add(new Option(label, id));
    }
    for (const option of select.options) {
      if (option.value === selected) select.value = selected;
    }
    select.disabled = matched === 0;
    document.querySelector("#map-go").disabled =
      !select.value || snapshot.loading;
    document.querySelector("#map-search-clear").disabled = query.length === 0;
    document.querySelector("#map-current").textContent = snapshot.currentMap
      ? `${this.api.mapName(snapshot.currentMap)} [${snapshot.currentMap}]`
      : "No field loaded";
    document.querySelector("#map-search-status").textContent = query
      ? `${matched} of ${snapshot.maps.length} maps match. ${matched ? "Select a destination, then Go." : "Clear or change your search."}`
      : `All ${snapshot.maps.length} maps in this asset catalog. Search by name or ID, or browse the full list.`;
  }
  refresh(snapshot) {
    if (!this.monsters || this.monsterBuild !== snapshot.buildId) {
      this.loadMonsters(snapshot);
    }
    this.updateSpawnAvailability(snapshot);
    if (
      snapshot.currentMap !== this.lastMap ||
      snapshot.buildId !== this.lastBuild
    ) {
      this.lastMap = snapshot.currentMap;
      this.lastBuild = snapshot.buildId;
      this.filterMaps(snapshot, this.lastMap);
    }
    document.querySelector("#map-go").disabled =
      !document.querySelector("#map").value || snapshot.loading;
    let changed = snapshot.entities.length !== this.lastEntities.length;
    if (snapshot.entities.length > MAX_INSPECTED_ENTITIES) {
      this.api.onError(
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
  const denied = snapshot.developmentControls?.available === false;
  document.querySelector("#scene-controls").disabled =
    !snapshot.currentMap || denied;
  document.querySelector("#pause").disabled = denied || snapshot.loading;
  document.querySelector("#reload").disabled = denied || snapshot.loading;
  document.querySelector("#scene-preview-controls").disabled =
    !snapshot.currentMap;
  document.querySelector("#input-config").disabled = !snapshot.currentMap;
  document.querySelector("#step").disabled =
    !snapshot.currentMap || snapshot.loading || denied;
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
