import { Container } from "pixi.js";
import { StreamScene } from "../rendering/stream-scene.js";
import { manifest as validateManifest } from "../rendering/stream-validation.js";
import { nearestSavedArrival } from "../world/field-arrival.js";

const CANDIDATE_NAMES = [
  "Henesys",
  "Ellinia",
  "Kerning City",
  ["Lith Harbor", "Lith Harbour"],
  "Orbis",
  "Ludibrium",
];
const HOLD_MS = 18000;
const FADE_MS = 1400;
const PAN_SPEED = 26;
const PAN_MARGIN = 60;

/** Presentation-only map scenery behind the account window; never field/gameplay authority. */
export class LoginBackdrop {
  constructor({ app, services, catalog, network, onError = null }) {
    this.app = app;
    this.services = services;
    this.catalog = catalog;
    this.network = network;
    this.onError = onError;
    this.container = new Container({ label: "login-backdrop" });
    this.container.eventMode = "none";
    this.controller = new AbortController();
    this.scenes = [];
    this.queue = [];
    this.heldMs = 0;
    this.fade = 0;
    this.loading = false;
    this.destroyed = false;
    this.failed = new Set();
  }

  /** Candidate ids resolve once by authored map name; unknown names are skipped, never guessed. */
  mapIds() {
    const names = new Map();
    for (const [id, name] of Object.entries(this.catalog?.mapNames ?? {})) {
      if (!this.catalog.maps?.[id]) continue;
      names.set(String(name).toLowerCase(), id);
    }
    const ids = [];
    for (const candidate of CANDIDATE_NAMES) {
      const variants = Array.isArray(candidate) ? candidate : [candidate];
      const id = variants
        .map((name) => names.get(name.toLowerCase()))
        .find((value) => value !== undefined);
      if (id) ids.push(id);
    }
    return ids;
  }

  async prepare(signal) {
    const ids = this.mapIds();
    if (!ids.length) return;
    this.queue = ids;
    this.app.stage.addChildAt(this.container, 0);
    const combined = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal;
    this.signal = combined;
    await this.showNext(combined);
  }

  async showNext(signal) {
    if (this.loading) return;
    const available = this.queue.filter((id) => !this.failed.has(id));
    if (!available.length) return;
    const id = available[Math.floor(Math.random() * available.length)];
    this.loading = true;
    let scene;
    try {
      scene = await this.loadScene(id, signal);
    } catch (error) {
      if (error?.name === "AbortError") return;
      // One unrenderable map must never block the account window.
      this.failed.add(id);
      this.onError?.(error);
      this.loading = false;
      return this.showNext(signal);
    } finally {
      this.loading = false;
    }
    if (this.destroyed || signal?.aborted) {
      scene.destroy();
      return;
    }
    scene.container.alpha = 0;
    const previous = this.scenes.at(-1) ?? null;
    this.scenes.push(scene);
    this.fade = 0;
    this.heldMs = 0;
    if (previous) previous.retiring = true;
  }

  async loadScene(id, signal) {
    const descriptor = this.catalog?.maps?.[id];
    if (!descriptor) {
      throw new Error(`Login backdrop map ${id} is not packaged`);
    }
    const manifest = validateManifest(
      await this.network.json(descriptor, signal),
    );
    const scene = new StreamScene(manifest, this.services, {
      width: this.app.screen.width,
      height: this.app.screen.height,
    });
    // Presentation-only: no character, mob, NPC or drop actors are instanced.
    await scene.preparePresentation(
      signal,
      nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 }),
    );
    if (this.destroyed || signal?.aborted) {
      scene.destroy();
      throw new DOMException("Backdrop cancelled", "AbortError");
    }
    this.container.addChildAt(scene.container, 0);
    this.frameScene(scene);
    return scene;
  }

  /** The sweep spans the authored map bounds so the camera never leaves packaged regions. */
  frameScene(scene) {
    const bounds = scene.manifest.bounds;
    const viewport = scene.viewport.width;
    const left = bounds.left + PAN_MARGIN;
    const right = Math.max(left, bounds.right - viewport - PAN_MARGIN);
    scene.pan = { left, right, direction: 1 };
    scene.camera.x = left;
    scene.camera.y = Math.min(
      Math.max(scene.camera.y, bounds.top),
      Math.max(bounds.top, bounds.bottom - scene.viewport.height),
    );
  }

  update(ms) {
    if (this.destroyed || !this.scenes.length) return;
    for (const scene of this.scenes) this.advanceScene(scene, ms);
    this.advanceCycle(ms);
  }

  /** Scenery advances authored frame timings; backgrounds also re-layout under the pan. */
  advanceScene(scene, ms) {
    scene.container.position.set(-scene.camera.x, -scene.camera.y);
    for (const entity of scene.backgrounds) {
      entity.updateBackground(scene.camera, scene.viewport);
    }
    for (const entity of scene.entities) {
      if (!entity.gameplayOwned) entity.advance(ms);
    }
    if (scene.retiring) return;
    const pan = scene.pan;
    scene.camera.x += pan.direction * PAN_SPEED * (ms / 1000);
    if (scene.camera.x <= pan.left || scene.camera.x >= pan.right) {
      pan.direction = -pan.direction;
      scene.camera.x = Math.min(pan.right, Math.max(pan.left, scene.camera.x));
    }
    scene.updateDemand();
  }

  advanceCycle(ms) {
    if (this.scenes.length === 1) {
      this.scenes[0].container.alpha = 1;
      this.heldMs += ms;
      if (this.heldMs >= HOLD_MS) {
        this.heldMs = 0;
        this.showNext(this.controller.signal).catch(() => {});
      }
      return;
    }
    this.fade = Math.min(1, this.fade + ms / FADE_MS);
    const [previous, current] = this.scenes;
    previous.container.alpha = 1 - this.fade;
    current.container.alpha = this.fade;
    if (this.fade < 1) return;
    previous.destroy();
    this.scenes.shift();
    this.heldMs = 0;
  }

  /** Entering the world removes the backdrop immediately; the field owns the canvas. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controller.abort();
    for (const scene of this.scenes) scene.destroy();
    this.scenes.length = 0;
    this.container.destroy({ children: true });
  }
}
