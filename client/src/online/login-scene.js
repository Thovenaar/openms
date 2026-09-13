import { Container } from "pixi.js";
import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { UIRasterPlane } from "../ui/ui-raster-plane.js";

// Native 800×600 login viewport; MapLogin is selected by string1306 at 00b2bc54.
const VIEWPORT = Object.freeze({ width: 800, height: 600 });
const MAX_ENTITIES = 128;
const MAX_SPRITES = 4096;

/** Original login field, using the same animation and background projection as play. */
export class LoginScene {
  constructor(host) {
    this.host = document.createElement("div");
    this.host.className = "online-login-scenery online-login-artwork";
    this.host.setAttribute("aria-hidden", "true");
    host.prepend(this.host);
    this.root = new Container({ label: "native-login-scene" });
    this.clip = new Container();
    this.clip.rasterClip = { x: 0, y: 0, ...VIEWPORT };
    this.world = new Container({ sortableChildren: true });
    this.clip.addChild(this.world);
    this.root.addChild(this.clip);
    this.plane = new UIRasterPlane(this.root, this.host);
    this.entities = [];
    this.camera = { x: -400, y: -308 };
    this.elapsedMs = 0;
    this.animated = 0;
    this.destroyed = false;
  }

  async prepare(catalog, services, signal) {
    const descriptor = catalog.ui?.bundles?.LoginScene;
    if (!descriptor) {
      throw new Error("Original UI.wz:MapLogin.img is not extracted");
    }
    const resource = await loadVisualBundle(descriptor, services, signal);
    if (this.destroyed) {
      resource.destroy();
      return;
    }
    this.resource = resource;
    const entities = resource.manifest.entities;
    if (entities.length > MAX_ENTITIES) {
      throw new Error("Login scene entity limit exceeded");
    }
    let sprites = 0;
    for (const entry of entities) {
      const animation = new EntityAnimation(entry, resource.textures);
      this.entities.push(animation);
      this.world.addChild(animation.container);
      if (entry.background) {
        animation.prepareBackground(VIEWPORT, MAX_SPRITES - sprites);
      }
      sprites += animation.sprites.length;
      if (sprites > MAX_SPRITES) {
        throw new Error("Login scene sprite limit exceeded");
      }
      if (entry.actions.default.length > 1) this.animated++;
    }
    this.update(this.camera, 0);
  }

  /** Camera is the top-left world pixel; milliseconds advance authored frame clocks. */
  update(camera, ms) {
    if (!this.resource || this.destroyed) return;
    this.elapsedMs += ms;
    this.camera.x = Math.trunc(camera.x);
    this.camera.y = Math.trunc(camera.y);
    this.world.position.set(-this.camera.x, -this.camera.y);
    for (const animation of this.entities) {
      animation.advance(ms);
      if (!animation.background) continue;
      animation.positionBackground(this.camera, VIEWPORT);
      animation.layoutBackground(this.camera, VIEWPORT);
      animation.drawBackground();
    }
    const ratio = window.devicePixelRatio || 1;
    this.plane.sync(ratio, ratio);
  }

  snapshot() {
    return {
      source: "UI.wz:MapLogin.img",
      camera: { ...this.camera },
      elapsedMs: Math.trunc(this.elapsedMs),
      entities: this.entities.length,
      animated: this.animated,
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.plane.destroy();
    this.root.destroy({ children: true });
    this.resource?.destroy();
    this.entities.length = 0;
    this.host.remove();
  }
}
