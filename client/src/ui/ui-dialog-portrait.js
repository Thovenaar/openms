import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { dialogPortraitGeometry } from "./ui-dialog-layout.js";

/** One portrait lease per mounted dialogue; replacement and closure invalidate pending loads. */
export class DialogPortrait {
  constructor(panel) {
    this.panel = panel;
    this.id = null;
    this.request = null;
    this.resource = null;
    this.animation = null;
    this.destroyed = false;
    this.layer = panel.layer("NPC portrait");
    this.bar = this.layer.image("UtilDlgEx/bar", 19, 3);
    // Native font0: white Arial12. Name y5 and bar y3 share a121×23 canvas.
    this.name = this.layer.text("", 19, 5, 121);
    this.name.style.cssText +=
      ";color:#fff;font:12px/14px Arial,sans-serif;text-align:center;white-space:nowrap;overflow:hidden;";
    this.setVisible(false);
  }

  setVisible(visible) {
    this.layer.root.visible = visible;
    this.layer.element.hidden = !visible;
  }

  hide() {
    this.request?.abort();
    this.id = null;
    this.release();
  }

  show(id, name) {
    if (this.destroyed) return;
    if (id === this.id) return;
    this.id = id;
    this.request?.abort();
    const entry = this.panel.owner.index.npcPortraits?.[id];
    if (!entry?.available) {
      this.name.title =
        entry?.reason ?? "NPC portrait is not in the offline package";
      this.panel.owner.report(new Error(this.name.title));
      return;
    }
    const request = new AbortController();
    this.request = request;
    this.load(entry.descriptor, request, name).catch((error) => {
      if (!request.signal.aborted && !this.destroyed) {
        this.id = null;
        this.panel.owner.report(error);
      }
    });
  }

  async load(descriptor, request, name) {
    const resource = await loadVisualBundle(
      descriptor,
      this.panel.owner.services,
      request.signal,
    );
    let animation = null;
    try {
      request.signal.throwIfAborted();
      if (this.destroyed || this.request !== request) return;
      const asset = resource.manifest.metadata.assets.NpcPortrait;
      if (!asset || !(asset.width > 0) || !(asset.height > 0)) {
        throw new Error("Missing original portrait bounds");
      }
      animation = new EntityAnimation(
        resource.manifest.entities[0],
        resource.textures,
      );
      // Keep the last complete portrait until its replacement is fully decoded.
      this.release();
      this.name.textContent = name ?? "";
      this.layer.root.addChild(animation.container);
      this.animation = animation;
      this.asset = asset;
      this.resource = resource;
      animation = null;
      if (this.geometry) this.setLayout(this.geometry);
      this.setVisible(true);
    } finally {
      animation?.container.destroy({ children: true });
      if (this.resource !== resource) resource.destroy();
    }
  }

  setLayout(geometry) {
    this.geometry = geometry;
    if (!this.asset || !this.animation) return;
    const position = dialogPortraitGeometry(
      geometry,
      this.asset,
      this.panel.assets["UtilDlgEx/bar"],
    );
    this.animation.setPosition(position.x, position.y);
    this.bar.setPosition(position.barX, position.barY);
    this.name.style.left = `${position.nameX}px`;
    this.name.style.top = `${position.nameY}px`;
    this.panel.renderArtwork();
  }

  release() {
    if (this.animation && !this.animation.container.destroyed) {
      this.animation.container.destroy({ children: true });
    }
    this.resource?.destroy();
    this.animation = null;
    this.resource = null;
    this.asset = null;
    this.setVisible(false);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.request?.abort();
    this.release();
    this.layer.destroy();
  }
}
