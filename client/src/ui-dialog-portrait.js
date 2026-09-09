import { EntityAnimation } from "./animation.js";
import { loadVisualBundle } from "./visual-resources.js";

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
    this.bar = this.layer.image("UtilDlgEx/bar", 19, 130);
    // 009a70e5 font0: white Arial12; 009a7481 centers the name at bar y+5.
    this.name = this.layer.text("", 19, 135, 121);
    this.name.style.cssText +=
      ";color:#fff;font:12px/14px Arial,sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  }

  show(id, name) {
    if (this.destroyed) return;
    this.name.textContent = name ?? "";
    if (id === this.id) return;
    this.id = id;
    this.request?.abort();
    this.release();
    const entry = this.panel.owner.index.npcPortraits?.[id];
    if (!entry?.available) {
      this.name.title =
        entry?.reason ?? "NPC portrait is not in the offline package";
      return;
    }
    const request = new AbortController();
    this.request = request;
    this.load(entry.descriptor, request).catch((error) => {
      if (!request.signal.aborted && !this.destroyed) {
        this.panel.owner.report(error);
      }
    });
  }

  async load(descriptor, request) {
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
      animation = new EntityAnimation(
        resource.manifest.entities[0],
        resource.textures,
      );
      // Native portrait column is centered at x80 (009a7745); fitting is browser policy.
      const scale = Math.min(1, 121 / asset.width, 96 / asset.height);
      animation.container.scale.set(scale);
      animation.setPosition(
        80 - (asset.width * scale) / 2 + asset.origin.x * scale,
        124 - asset.height * scale + asset.origin.y * scale,
      );
      this.layer.root.addChild(animation.container);
      this.animation = animation;
      this.resource = resource;
      animation = null;
    } finally {
      animation?.container.destroy({ children: true });
      if (this.resource !== resource) resource.destroy();
    }
  }

  release() {
    if (this.animation && !this.animation.container.destroyed) {
      this.animation.container.destroy({ children: true });
    }
    this.resource?.destroy();
    this.animation = null;
    this.resource = null;
  }

  destroy() {
    this.destroyed = true;
    this.request?.abort();
    this.release();
    this.layer.destroy();
  }
}
