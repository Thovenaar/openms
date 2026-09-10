import { EntityAnimation } from "./animation.js";
import { AVATAR_LIMITS } from "./avatar-composition.js";

/** Only composition inputs participate; inventory stats and profile commits are not appearances. */
function appearanceIdentity(profile) {
  const appearance = profile?.appearance;
  if (
    !appearance ||
    !Number.isInteger(appearance.skin) ||
    !Number.isSafeInteger(appearance.face) ||
    !Number.isSafeInteger(appearance.hair) ||
    ![0, 1].includes(profile.gender) ||
    !Array.isArray(profile.equipment) ||
    profile.equipment.length > AVATAR_LIMITS.items - 4
  ) {
    throw new Error("Invalid portrait appearance");
  }
  const equipment = profile.equipment.map((item) => {
    if (
      !Number.isSafeInteger(item.id) ||
      !Number.isInteger(item.slot) ||
      item.slot >= 0 ||
      item.slot < -199
    ) {
      throw new Error("Invalid portrait equipment");
    }
    return [item.slot, item.id];
  });
  equipment.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  return JSON.stringify([
    appearance.skin,
    appearance.face,
    appearance.hair,
    profile.gender,
    equipment,
  ]);
}

/** Native UI surfaces supply their sourced feet position and own clipping/depth/density.
 * Every portrait owns independent atlas leases, including portraits of the current field actor. */
export class NativeAvatarPortrait {
  constructor(surface, visuals, { x, y, z = 0, id = "avatar-portrait" }) {
    if (!surface?.root || ![x, y, z].every(Number.isFinite)) {
      throw new Error("Invalid avatar portrait surface");
    }
    this.surface = surface;
    this.visuals = visuals;
    this.entity = {
      id,
      order: 0,
      kind: "character",
      x,
      y,
      z,
      visible: true,
      flip: false,
      opacity: 1,
      action: "stand1",
    };
    this.request = null;
    this.prepared = null;
    this.animation = null;
    this.bounds = null;
    this.identity = null;
    this.surfaceClock = false;
    this.destroyed = false;
  }

  /** Resolve to original pixel bounds relative to feet, or reject; retain the last complete portrait on error. */
  async refresh(profile) {
    if (this.destroyed) throw new Error("Avatar portrait is destroyed");
    let identity;
    try {
      identity = appearanceIdentity(profile);
    } catch (error) {
      this.request?.controller.abort();
      this.request = null;
      throw error;
    }
    if (this.request?.identity === identity) return this.request.promise;
    this.request?.controller.abort();
    this.request = null;
    if (this.identity === identity) return this.bounds;
    const request = {
      controller: new AbortController(),
      identity,
      promise: null,
    };
    this.request = request;
    request.promise = this.prepare(profile, request);
    return request.promise;
  }

  async prepare(profile, request) {
    const signal = request.controller.signal;
    let prepared = null;
    let animation = null;
    try {
      prepared = await this.visuals.prepare(profile, {
        signal,
        entity: this.entity,
      });
      signal.throwIfAborted();
      if (this.destroyed || this.request !== request) {
        throw new DOMException("Stale avatar portrait", "AbortError");
      }
      animation = new EntityAnimation(prepared.entity, prepared.textures);
      animation.setAction(prepared.standAction);
      animation.setPosition(this.entity.x, this.entity.y);
      this.surface.root.addChild(animation.container);
      this.release();
      this.animation = animation;
      this.prepared = prepared;
      this.bounds = prepared.bounds;
      this.identity = request.identity;
      if (this.surfaceClock) this.surface.timedSprites.push(animation);
      animation = null;
      return this.bounds;
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      animation?.container.destroy({ children: true });
      if (this.prepared !== prepared) prepared?.destroy();
      // Keep one failed result too: unrelated commits must not become implicit asset retries.
      if (this.request === request && this.identity === request.identity) {
        this.request = null;
      }
    }
  }

  /** Opt in only for ordinary UI surfaces; NPC script portraits retain their manual clock. */
  useSurfaceClock() {
    if (this.destroyed || this.surfaceClock) return;
    if (!Array.isArray(this.surface.timedSprites)) {
      throw new Error("Avatar portrait has no UI clock");
    }
    this.surfaceClock = true;
    if (this.animation) this.surface.timedSprites.push(this.animation);
  }

  /** Caller advances its existing UI animation owner; no timers, listeners or per-tick allocations. */
  update(ms) {
    if (!this.surfaceClock) this.animation?.advance(ms);
  }

  setPosition(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("Invalid portrait position");
    }
    this.entity.x = x;
    this.entity.y = y;
    this.animation?.setPosition(x, y);
  }

  release() {
    if (this.surfaceClock && this.animation) {
      const index = this.surface.timedSprites.indexOf(this.animation);
      if (index >= 0) this.surface.timedSprites.splice(index, 1);
    }
    this.animation?.container.destroy({ children: true });
    this.prepared?.destroy();
    this.animation = null;
    this.prepared = null;
    this.bounds = null;
    this.identity = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.request?.controller.abort();
    this.request = null;
    this.release();
  }
}
