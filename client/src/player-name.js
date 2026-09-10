import { Container, Graphics, Text } from "pixi.js";

const DESTROY = Object.freeze({ children: true });

/** Plain category1000 in00942dcc ->005f0334; native font cache slot0.
 * Native vector attachment and canvas padding are retained; browser font metrics
 * and glyph rasterization are not claimed identical to Windows Arial. */
export class PlayerName {
  constructor(scene, store) {
    this.scene = scene;
    this.store = store;
    this.name = null;
    this.resolution = 0;
    this.destroyed = false;
    this.container = new Container({ label: "player-world-name" });
    this.container.zIndex = 2; // 005f17bb: relative to the supplied actor layer.
    this.background = new Graphics();
    this.text = new Text({
      text: "",
      style: { fontFamily: "Arial", fontSize: 12, fill: 0xffffff },
    });
    this.container.addChild(this.background, this.text);
    scene.actor.container.addChild(this.container);
    scene.registerPresentationContainer(this.container);
  }

  /** Project after updatePresentation; density is the renderer's actual resolution.
   * @param {number} resolution Positive backing pixels per logical pixel. */
  step(resolution) {
    if (this.destroyed) return;
    if (!Number.isFinite(resolution) || resolution <= 0) {
      throw new Error("Invalid player name rendering resolution");
    }
    const name = this.store.profile.name;
    if (this.name !== name || this.resolution !== resolution) {
      this.rebuild(name, resolution);
    }
    // Native name overlay is an actor child, but its origin vector is not flipped.
    const direction = this.scene.actor.container.scale.x;
    this.container.scale.x = direction;
    this.container.position.set(this.offsetX * direction, 2);
  }

  /** Native005f12e5..1694: measured width+5, font height+4, text(2,0),
   * origin(trunc(width/2),-2). Four ARGB00ffffff corners are transparent. */
  rebuild(name, resolution) {
    this.name = name;
    this.resolution = resolution;
    this.text.resolution = resolution;
    this.text.text = name;
    const width = Math.ceil(this.text.width) + 5;
    const height = Math.ceil(this.text.height) + 4;
    this.text.position.set(2, 0);
    this.background
      .clear()
      .rect(1, 0, width - 2, height)
      .rect(0, 1, 1, height - 2)
      .rect(width - 1, 1, 1, height - 2)
      .fill({ color: 0, alpha: 160 / 255 });
    this.offsetX = -Math.trunc(width / 2);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.unregisterPresentationContainer(this.container);
    this.container.destroy(DESTROY);
  }
}
