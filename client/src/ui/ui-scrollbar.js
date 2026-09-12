// Original CCtrlScrollBar: 004d7145 resource states, 004d7dc6 clamp,
// 004d8189 track step, 004d827f thumb conversion. Count means positions, not rows.
export class NativeScrollbar {
  constructor(panel, geometry, changed) {
    this.panel = panel;
    this.geometry = geometry;
    this.changed = changed;
    this.position = 0;
    this.count = 1;
    this.visible = true;
    this.drag = null;
    this.pressed = null;
    this.layer = panel.layer("Native scrollbar");
    this.parts = new Map();
    this.build();
    panel.listen(panel.element, "wheel", (event) => this.wheel(event));
    this.layer.cleanups.push(() => clearInterval(this.repeatTimer));
    this.draw();
  }

  build() {
    const { extent, horizontal = false, style = 3 } = this.geometry;
    if (!Number.isInteger(style) || style < 0 || style > 3) {
      throw new Error("Unsupported native scrollbar style");
    }
    // 004d6d96 + original strings00af1e14/18/20: styles1/2/3 append2/3/4.
    const branch = `${horizontal ? "HScr" : "VScr"}${style === 0 ? "" : style + 1}`;
    this.horizontal = horizontal;
    this.branch = branch;
    const asset = this.panel.assets[`${branch}/enabled/prev0`];
    if (!asset) {
      throw new Error(`Missing original ${branch} scrollbar resources`);
    }
    this.arrow = horizontal ? asset.width : asset.height;
    this.width = horizontal ? asset.height : asset.width;
    this.thumb = this.panel.assets[`${branch}/enabled/thumb0`];
    this.thumbExtent = horizontal ? this.thumb.width : this.thumb.height;
    this.travel = Math.max(0, extent - 2 * this.arrow - this.thumbExtent);
    this.buildTrack();
    this.#buildParts();
    this.#buildHit();
  }

  #buildParts() {
    const { x, y } = this.geometry;
    for (const suffix of [
      "enabled/prev0",
      "enabled/prev1",
      "disabled/prev",
      "enabled/next0",
      "enabled/next1",
      "disabled/next",
      "enabled/thumb0",
      "enabled/thumb1",
    ]) {
      const path = `${this.branch}/${suffix}`;
      this.parts.set(suffix, this.layer.image(path, x, y));
    }
  }

  #buildHit() {
    const { x, y, extent } = this.geometry;
    const horizontal = this.horizontal;
    this.hit = this.layer.hit(
      "Scroll",
      {
        x,
        y,
        width: horizontal ? extent : this.width,
        height: horizontal ? this.width : extent,
      },
      {
        pointerdown: (event) => this.down(event),
        pointermove: (event) => this.move(event),
        pointerup: (event) => this.up(event),
        pointercancel: () => this.cancel(),
        lostpointercapture: () => this.cancel(),
        keydown: (event) => this.key(event),
      },
    );
    this.hit.setAttribute("role", "scrollbar");
    this.hit.setAttribute(
      "aria-orientation",
      horizontal ? "horizontal" : "vertical",
    );
  }

  buildTrack() {
    this.tracks = [];
    const { x, y, extent } = this.geometry;
    const length = extent - 2 * this.arrow;
    const trackLayer = this.layer.layer("Tiled scrollbar track");
    trackLayer.root.rasterClip = {
      x: x + (this.horizontal ? this.arrow : 0),
      y: y + (this.horizontal ? 0 : this.arrow),
      width: this.horizontal ? length : this.width,
      height: this.horizontal ? this.width : length,
    };
    for (const state of ["enabled", "disabled"]) {
      const path = `${this.branch}/${state}/base`;
      const asset = this.panel.assets[path];
      const step = this.horizontal ? asset.width : asset.height;
      if (step <= 0 || Math.ceil(length / step) > 1024) {
        throw new Error("Invalid scrollbar track extent");
      }
      const sprites = [];
      for (let offset = 0; offset < length; offset += step) {
        const sprite = trackLayer.image(
          path,
          x + (this.horizontal ? this.arrow + offset : 0),
          y + (this.horizontal ? 0 : this.arrow + offset),
        );
        sprites.push(sprite);
      }
      this.tracks.push({ state, sprites });
    }
  }

  setRange(count, position = this.position) {
    if (!Number.isInteger(count) || count < 1 || !Number.isFinite(position)) {
      throw new Error("Invalid scrollbar range");
    }
    this.count = count;
    this.position = Math.max(0, Math.min(count - 1, Math.trunc(position)));
    this.draw();
  }

  setVisible(visible) {
    this.visible = visible;
    this.layer.root.visible = visible;
    this.layer.element.hidden = !visible;
    if (!visible) this.cancel();
  }

  setPosition(position) {
    const next = Math.max(0, Math.min(this.count - 1, Math.trunc(position)));
    if (next === this.position) return;
    this.position = next;
    this.panel.owner.hideTooltip();
    this.draw();
    this.changed(next);
  }

  coordinate(event) {
    const bounds = this.hit.getBoundingClientRect();
    return this.horizontal
      ? ((event.clientX - bounds.left) * this.geometry.extent) / bounds.width
      : ((event.clientY - bounds.top) * this.geometry.extent) / bounds.height;
  }

  down(event) {
    if (event.button !== 0 || this.count < 2 || this.drag || this.pressed) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.pointerPoint = this.coordinate(event);
    if (event.isTrusted || !this.panel.owner.replayingNativeInput) {
      this.hit.setPointerCapture(event.pointerId);
    }
    const part = this.partAt(this.pointerPoint);
    if (part === "thumb") {
      this.drag = { point: this.pointerPoint, position: this.position };
    } else {
      this.pressed = part;
      this.repeat();
      // 004d8088 repeats when unsigned elapsed tick count is strictly greater than50ms.
      this.repeatTimer = setInterval(() => this.repeat(), 51);
    }
    this.draw();
  }

  move(event) {
    this.pointerPoint = this.coordinate(event);
    if (!this.drag || this.travel === 0) {
      if (this.pressed) this.draw();
      return;
    }
    const delta = this.pointerPoint - this.drag.point;
    this.setPosition(
      this.drag.position + Math.round((delta * (this.count - 1)) / this.travel),
    );
  }

  up(event) {
    this.cancel();
    if (this.hit.hasPointerCapture(event.pointerId)) {
      this.hit.releasePointerCapture(event.pointerId);
    }
  }

  cancel() {
    clearInterval(this.repeatTimer);
    this.repeatTimer = null;
    this.drag = null;
    this.pressed = null;
    this.draw();
  }

  partAt(point) {
    if (point < 0 || point >= this.geometry.extent) return null;
    if (point < this.arrow) return "prev";
    if (point >= this.geometry.extent - this.arrow) return "next";
    const thumb =
      this.arrow + (this.travel * this.position) / Math.max(1, this.count - 1);
    if (point < thumb) return "before";
    if (point < thumb + this.thumbExtent) return "thumb";
    return "after";
  }

  repeat() {
    if (!this.pressed || this.partAt(this.pointerPoint) !== this.pressed) {
      return;
    }
    const page = Math.max(16, Math.trunc(this.count / 16));
    const delta =
      this.pressed === "prev"
        ? -1
        : this.pressed === "next"
          ? 1
          : this.pressed === "before"
            ? -page
            : page;
    this.setPosition(this.position + delta);
  }

  wheel(event) {
    if (!this.visible || event.deltaY === 0) return;
    event.preventDefault();
    this.setPosition(this.position + Math.sign(event.deltaY));
  }

  key(event) {
    const steps = {
      ArrowUp: -1,
      ArrowLeft: -1,
      ArrowDown: 1,
      ArrowRight: 1,
      PageUp: -Math.max(16, Math.trunc(this.count / 16)),
      PageDown: Math.max(16, Math.trunc(this.count / 16)),
      Home: -this.count,
      End: this.count,
    };
    if (steps[event.key] === undefined) return;
    event.preventDefault();
    this.setPosition(this.position + steps[event.key]);
  }

  draw() {
    const enabled = this.count > 1;
    this.#drawTracks(enabled);
    for (const [name, sprite] of this.parts) {
      this.#drawPart(name, sprite, enabled);
    }
    this.hit?.setAttribute("aria-valuemin", "0");
    this.hit?.setAttribute("aria-valuemax", String(this.count - 1));
    this.hit?.setAttribute("aria-valuenow", String(this.position));
    this.hit?.setAttribute("aria-disabled", String(!enabled));
    this.panel.renderArtwork();
  }

  #drawTracks(enabled) {
    for (const track of this.tracks) {
      for (const sprite of track.sprites) {
        sprite.container.visible =
          track.state === (enabled ? "enabled" : "disabled");
      }
    }
  }

  #drawPart(name, sprite, enabled) {
    const { x, y } = this.geometry;
    const active = name.startsWith(enabled ? "enabled/" : "disabled/");
    // 004d74e4 selects0/1 only; authored state2 has no consumer in this class.
    const pressed = this.#partPressed(name);
    sprite.container.visible =
      active &&
      (!enabled || name.endsWith("base") || name.endsWith(pressed ? "1" : "0"));
    const offset = this.#partOffset(name, enabled);
    const asset = this.panel.assets[`${this.branch}/${name}`];
    sprite.setPosition(
      x + (this.horizontal ? offset : 0) + asset.origin.x,
      y + (this.horizontal ? 0 : offset) + asset.origin.y,
    );
  }

  #partPressed(name) {
    return name.includes("thumb")
      ? Boolean(this.drag)
      : this.pressed === (name.includes("prev") ? "prev" : "next") &&
          this.partAt(this.pointerPoint) === this.pressed;
  }

  #partOffset(name, enabled) {
    if (name.includes("next")) return this.geometry.extent - this.arrow;
    if (!name.includes("thumb")) return 0;
    return (
      this.arrow +
      (enabled
        ? Math.trunc((this.travel * this.position) / (this.count - 1))
        : 0)
    );
  }
}
