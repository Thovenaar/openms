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
    this.bar = this.layer.image("UtilDlgEx/bar", 19, 0);
    // 009a70e5 font0, 009a7481: white Arial12, centered within original121px bar, baseline offset5.
    this.name = this.layer.text("", 19, 5, 121);
    this.name.style.cssText +=
      ";color:#fff;font:12px/14px Arial,sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
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
    this.name.textContent = name ?? "";
    if (id === this.id) return;
    this.id = id;
    this.request?.abort();
    this.release();
    const entry = this.panel.owner.index.npcPortraits?.[id];
    if (!entry?.available) {
      this.name.title =
        entry?.reason ?? "NPC portrait is not in the offline package";
      this.panel.owner.report(new Error(this.name.title));
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
      if (!asset || !(asset.width > 0) || !(asset.height > 0)) {
        throw new Error("Missing original portrait bounds");
      }
      animation = new EntityAnimation(
        resource.manifest.entities[0],
        resource.textures,
      );
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
    const { width, height, origin } = this.asset;
    const bar = this.panel.assets["UtilDlgEx/bar"];
    const combined = height + bar.height;
    // 009a7745..009a7b69: unscaled NPC at column80/450; tall portraits bottom-anchor above footer.
    const center = geometry.right ? 450 : 80;
    const top =
      combined > geometry.body
        ? geometry.height - combined - 62
        : 28 + Math.trunc((geometry.body - combined) / 2);
    const barY =
      combined > geometry.body
        ? geometry.height - combined - 52 + height
        : top + height;
    this.animation.setPosition(
      center - Math.trunc(width / 2) + origin.x,
      top + origin.y,
    );
    this.bar.setPosition(
      center - Math.trunc(bar.width / 2) + bar.origin.x,
      barY + bar.origin.y,
    );
    this.name.style.left = `${center - Math.trunc(bar.width / 2)}px`;
    this.name.style.top = `${barY + 5}px`;
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
