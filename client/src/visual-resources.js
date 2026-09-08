import { Rectangle, Texture } from "pixi.js";
import { check } from "./stream-network.js";
import { visualBundle } from "./stream-validation.js";

/** Validated frame collections determine dependencies once, outside rendering. */
function requiredAtlases(values, manifest) {
  const result = new Set();
  for (const entity of values) {
    for (const frames of Object.values(entity.actions)) {
      for (const frame of frames) {
        for (const part of frame.parts) {
          result.add(manifest.textures[part.texture].atlas);
        }
      }
    }
  }
  return result;
}

/** Subtextures belong to this owner; atlas sources retain shared refcounted ownership. */
export class VisualTextures {
  constructor(manifest, atlasStore) {
    this.manifest = manifest;
    this.atlasStore = atlasStore;
    this.textures = new Map();
    this.leases = [];
    this.destroyed = false;
    this.controller = new AbortController();
    this.cancelBound = this.destroy.bind(this);
  }

  /** Caller validates entities and destroys display objects before releasing textures. */
  async load(values, signal, allowed = null) {
    check(signal);
    const sources = new Map();
    signal.addEventListener("abort", this.cancelBound, { once: true });
    try {
      for (const id of requiredAtlases(values, this.manifest)) {
        if (allowed && !allowed.includes(id)) {
          throw new Error("Region atlas dependency omitted");
        }
        const lease = this.atlasStore.acquire(
          this.manifest.atlases[id],
          this.controller.signal,
        );
        this.leases.push(lease);
        sources.set(id, await lease.ready);
        check(signal);
        check(this.controller.signal);
      }
      for (const entity of values) {
        for (const frames of Object.values(entity.actions)) {
          this.buildTextures(frames, sources);
        }
      }
      return this;
    } catch (error) {
      this.destroy();
      throw error;
    } finally {
      // A completed load no longer belongs to its caller's transient request.
      signal.removeEventListener("abort", this.cancelBound);
    }
  }

  buildTextures(frames, sources) {
    for (const frame of frames) {
      for (const part of frame.parts) {
        if (this.textures.has(part.texture)) continue;
        const info = this.manifest.textures[part.texture];
        this.textures.set(
          part.texture,
          new Texture({
            source: sources.get(info.atlas),
            frame: new Rectangle(info.x, info.y, info.width, info.height),
          }),
        );
      }
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const texture of this.textures.values()) texture.destroy(false);
    this.controller.abort();
    for (const lease of this.leases) lease.release();
    this.textures.clear();
    this.leases.length = 0;
  }
}

/** A demand-loaded UI/effect bundle uses the same hash-verified network and atlas budgets. */
export async function loadVisualBundle(descriptor, services, signal) {
  const manifest = visualBundle(
    await services.network.json(descriptor, signal),
  );
  check(signal);
  const owner = new VisualTextures(manifest, services.atlases);
  return owner.load(manifest.entities, signal);
}
