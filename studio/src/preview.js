import { Application, Graphics } from "pixi.js";
import { Network } from "../../client/src/rendering/stream-network.js";
import { AtlasStore } from "../../client/src/rendering/stream-atlas.js";
import { StreamScene } from "../../client/src/rendering/stream-scene.js";
import { VisualTextures } from "../../client/src/rendering/visual-resources.js";
import { EntityAnimation } from "../../client/src/rendering/animation.js";

/** Read-only native artwork, with an editable geometry overlay owned by Studio. */
export class StudioPreview {
  constructor(host, { place, error }) {
    this.host = host;
    this.place = place;
    this.error = error;
    this.scene = null;
    this.mode = "pan";
    this.generation = 0;
    this.drag = null;
    this.definition = null;
    this.app = new Application();
    this.network = new Network();
    this.view = { width: 600, height: 400 };
    this.controller = new AbortController();
    this.ready = this.initialize();
  }

  async initialize() {
    await this.app.init({
      width: 600,
      height: 400,
      background: "#d6e2db",
      antialias: false,
      autoStart: false,
      preference: "webgl",
    });
    this.app.canvas.setAttribute("aria-label", "Map and sprite preview");
    this.host.append(this.app.canvas);
    this.atlases = new AtlasStore(this.app.renderer, this.network, {
      workerURL: "/studio/atlas-worker.js",
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host);
    this.resize();
    const options = { signal: this.controller.signal };
    this.app.canvas.addEventListener(
      "pointerdown",
      (event) => this.pointerDown(event),
      options,
    );
    this.app.canvas.addEventListener(
      "pointermove",
      (event) => this.pointerMove(event),
      options,
    );
    this.app.canvas.addEventListener(
      "pointerup",
      (event) => this.pointerUp(event),
      options,
    );
    this.timer = setInterval(() => this.tick(), 50);
    this.demand = setInterval(() => this.scene?.updateDemand(), 200);
  }

  resize() {
    const box = this.host.getBoundingClientRect();
    this.view.width = Math.max(100, Math.round(box.width));
    this.view.height = Math.max(100, Math.round(box.height));
    this.app.renderer.resize(this.view.width, this.view.height);
  }

  clear() {
    this.generation++;
    this.pendingController?.abort();
    this.releaseView();
  }

  releaseView() {
    this.loadController?.abort();
    this.scene?.destroy();
    this.scene = null;
    this.sprite?.container.destroy({ children: true });
    this.sprite = null;
    this.visuals?.destroy();
    this.visuals = null;
    if (this.geometry && !this.geometry.destroyed) this.geometry.destroy();
    this.geometry = null;
  }

  async map(manifest, definition = null, resources = {}) {
    await this.ready;
    const generation = ++this.generation;
    this.pendingController?.abort();
    const controller = new AbortController();
    this.pendingController = controller;
    const network = {
      json: (descriptor, signal) =>
        resources[descriptor.sha256]
          ? Promise.resolve(resources[descriptor.sha256])
          : this.network.json(descriptor, signal),
    };
    const scene = new StreamScene(
      manifest,
      { network, atlases: this.atlases },
      this.view,
    );
    const portal = manifest.physics.portals.find(
      (value) => value.type === 0,
    ) ?? { x: manifest.camera.x + 300, y: manifest.camera.y + 200 };
    try {
      await scene.preparePresentation(controller.signal, portal);
      if (generation !== this.generation) {
        scene.destroy();
        return;
      }
      this.releaseView();
      this.loadController = controller;
      this.scene = scene;
      this.definition = definition;
      this.app.stage.addChild(scene.container);
      this.geometry = new Graphics();
      scene.overlays.addChild(this.geometry);
      this.drawGeometry();
    } catch (error) {
      scene.destroy();
      if (error.name !== "AbortError" && generation === this.generation) {
        throw error;
      }
    }
  }

  async visual(visual) {
    await this.ready;
    const generation = ++this.generation;
    this.pendingController?.abort();
    const controller = new AbortController();
    this.pendingController = controller;
    const visuals = new VisualTextures(visual, this.atlases);
    let sprite;
    try {
      await visuals.load([visual.entity], controller.signal);
      if (generation !== this.generation) {
        visuals.destroy();
        return;
      }
      sprite = new EntityAnimation(
        { ...visual.entity, x: 0, y: 0 },
        visuals.textures,
      );
    } catch (error) {
      visuals.destroy();
      throw error;
    }
    this.releaseView();
    this.loadController = controller;
    this.visuals = visuals;
    this.sprite = sprite;
    sprite.container.position.set(
      this.view.width / 2,
      this.view.height / 2 + 40,
    );
    sprite.container.scale.set(2);
    this.app.stage.addChild(sprite.container);
  }

  tick() {
    if (this.scene) {
      const { camera, container, entities, backgrounds } = this.scene;
      container.position.set(-Math.round(camera.x), -Math.round(camera.y));
      for (const entity of entities) entity.advance(50);
      for (const background of backgrounds) {
        background.updateBackground(camera, this.view);
      }
      if (this.scene.lastError && this.lastError !== this.scene.lastError) {
        this.lastError = this.scene.lastError;
        this.error(new Error(this.lastError));
      }
    }
    this.sprite?.advance(50);
    this.app.renderer.render(this.app.stage);
  }

  drawGeometry() {
    if (!this.scene || !this.geometry) return;
    const draw = this.geometry;
    const definition = this.definition ?? {
      footholds: this.scene.manifest.physics.footholds,
      ladders: [],
      spawns: [],
      entities: [],
    };
    draw.clear();
    this.drawFloors(
      definition.footholds ?? this.scene.manifest.physics.footholds,
    );
    this.drawMarkers(definition);
  }

  drawFloors(floors) {
    const draw = this.geometry;
    for (const floor of floors) {
      draw
        .moveTo(floor.x1, floor.y1)
        .lineTo(floor.x2, floor.y2)
        .stroke({ width: 2, color: 0x74e5b1, alpha: 0.7 });
    }
  }

  drawMarkers(definition) {
    const draw = this.geometry;
    for (const ladder of definition.ladders ?? []) {
      draw
        .moveTo(ladder.x, ladder.y1)
        .lineTo(ladder.x, ladder.y2)
        .stroke({ width: 4, color: 0xe9bc6b });
    }
    for (const spawn of definition.spawns) {
      draw
        .circle(spawn.x, spawn.y - 12, 12)
        .fill({ color: 0xed8557, alpha: 0.8 });
    }
    for (const decoration of definition.entities) {
      draw
        .rect(decoration.x - 7, decoration.y - 14, 14, 14)
        .fill({ color: 0x75b8ef, alpha: 0.9 });
    }
  }

  point(event) {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: Math.round(event.clientX - rect.left + this.scene.camera.x),
      y: Math.round(event.clientY - rect.top + this.scene.camera.y),
    };
  }

  pointerDown(event) {
    if (!this.scene) return;
    this.app.canvas.setPointerCapture(event.pointerId);
    this.drag = {
      pointer: { x: event.clientX, y: event.clientY },
      world: this.point(event),
      camera: { ...this.scene.camera },
    };
  }

  pointerMove(event) {
    if (!this.drag || this.mode !== "pan") return;
    this.scene.camera.x =
      this.drag.camera.x - event.clientX + this.drag.pointer.x;
    this.scene.camera.y =
      this.drag.camera.y - event.clientY + this.drag.pointer.y;
  }

  pointerUp(event) {
    if (!this.drag) return;
    if (this.mode !== "pan") {
      this.place(this.mode, this.drag.world, this.point(event));
    }
    this.drag = null;
  }

  destroy() {
    this.controller.abort();
    clearInterval(this.timer);
    clearInterval(this.demand);
    this.observer?.disconnect();
    this.clear();
    this.atlases?.destroy();
    this.app.destroy(true);
  }
}
