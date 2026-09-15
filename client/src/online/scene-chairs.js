import { EntityAnimation } from "../rendering/animation.js";
import { logPrefix } from "../../../shared/development-log.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";

const MAX_CHAIR_SEATS = 512;
const MAX_CHAIR_TEMPLATES = 64;

/** Seat identity is the Install template id; only authored chair art is drawn. */
export function chairTemplateId(entity) {
  if (entity?.kind !== "player") return 0;
  const id = entity.seat?.id;
  return Number.isSafeInteger(id) && Math.floor(id / 10000) === 301 ? id : null;
}

/** Authored chair effects are bottom-anchored on the character's feet, so the current
 *  `-origin` draw needs a per-template lift of `height - origin.y` (52 px for The
 *  Relaxer). Measured across `Item.wz:Install/0301.img` sit items: 46-63 px content
 *  bottoms with canvas heights 34-174. The draw anchor itself is inferred; the loader
 *  (`FUN_0093c7c3`) only proves the effect canvases and their per-user placement. */
export function chairAnchorLift(properties) {
  const frame = properties?.effect?.["0"];
  if (
    !frame ||
    !Number.isFinite(frame.height) ||
    !Number.isFinite(frame.origin?.y)
  ) {
    return 0;
  }
  return frame.height - frame.origin.y;
}

/** Chair artwork belongs to the seat's player, never to a second actor or a map seat.
 *  One demand-loaded template is shared by every player sitting in the same chair. */
export class SceneChairs {
  constructor(owner) {
    this.owner = owner;
    this.seats = new Map();
    this.templates = new Map();
    this.failures = new Set();
  }

  /** Called for every resident view each frame; loading starts only on a seat change. */
  observe(view, x, y) {
    const templateId = chairTemplateId(view.entity);
    const seat = this.seats.get(view.entity.id);
    if (!templateId) {
      if (seat) this.release(view.entity.id);
      return;
    }
    if (seat?.templateId === templateId) {
      this.position(seat, view, x, y);
      return;
    }
    if (seat) this.release(view.entity.id);
    this.acquire(view, templateId);
  }

  acquire(view, templateId) {
    if (this.seats.size >= MAX_CHAIR_SEATS) {
      throw new Error("Online chair seat residency limit");
    }
    const entry = this.template(templateId);
    if (!entry) return;
    entry.users++;
    const slot = { templateId, entry, animation: null };
    this.seats.set(view.entity.id, slot);
    const attach = () => {
      if (this.seats.get(view.entity.id) !== slot) return;
      slot.animation = this.createAnimation(view, entry, templateId);
      if (!slot.animation) {
        this.seats.delete(view.entity.id);
        this.unuse(entry);
        return;
      }
      this.position(slot, view, view.drawX, view.drawY);
    };
    if (entry.resource) attach();
    else {
      entry.pending.then(attach, () => {
        if (this.seats.get(view.entity.id) !== slot) return;
        this.seats.delete(view.entity.id);
        this.unuse(entry);
      });
    }
  }

  template(templateId) {
    if (this.failures.has(templateId)) return null;
    const existing = this.templates.get(templateId);
    if (existing) return existing;
    if (this.templates.size >= MAX_CHAIR_TEMPLATES) {
      throw new Error("Online chair template residency limit");
    }
    const item = this.owner.catalog?.ui?.items?.[templateId];
    const descriptor = item?.descriptor;
    if (!descriptor) {
      this.failures.add(templateId);
      return null;
    }
    // A missing chair artwork must never fail the field; the seat simply draws no art.
    const entry = {
      id: templateId,
      users: 0,
      resource: null,
      pending: null,
      lift: chairAnchorLift(item?.properties),
    };
    entry.pending = loadVisualBundle(
      descriptor,
      this.owner.services,
      this.owner.controller.signal,
    )
      .then((resource) => {
        entry.resource = resource;
      })
      .catch((error) => {
        this.failures.add(templateId);
        this.templates.delete(templateId);
        if (error?.name !== "AbortError") {
          console.warn(
            logPrefix("client"),
            "Chair artwork unavailable:",
            templateId,
            error,
          );
        }
        throw error;
      });
    entry.pending.catch(() => {});
    this.templates.set(templateId, entry);
    return entry;
  }

  createAnimation(view, entry, templateId) {
    const original = entry.resource.manifest.entities.find(
      (entity) => entity.id === `item/${templateId}/effect`,
    );
    if (!original) {
      this.failures.add(templateId);
      return null;
    }
    const animation = new EntityAnimation(
      { ...original, id: `chair:${view.entity.id}` },
      entry.resource.textures,
    );
    animation.gameplayOwned = true;
    animation.container.eventMode = "none";
    this.owner.scene.addDynamicEntity(animation);
    return animation;
  }

  position(seat, view, x, y) {
    const animation = seat.animation;
    if (!animation) return;
    // Chair artwork is bottom-anchored on the feet: the authored effect canvas spans
    // floor(feet - height) .. feet, while a raw -origin draw would sink it ~50 px.
    animation.setPosition(x, y - (seat.entry.lift ?? 0));
    animation.container.scale.x = view.entity.facing > 0 ? -1 : 1;
    // Equal foothold z draws before its player; the seat never covers the avatar.
    this.owner.scene.setEntityDepth(
      animation,
      (view.animation.container.zIndex ?? 29997) - 1,
    );
  }

  draw(elapsed) {
    for (const seat of this.seats.values()) seat.animation?.advance(elapsed);
  }

  release(entityId) {
    const seat = this.seats.get(entityId);
    if (!seat) return;
    this.seats.delete(entityId);
    if (seat.animation) {
      this.owner.scene.removeDynamicEntity(seat.animation.id);
      seat.animation.container.destroy({ children: true });
    }
    this.unuse(seat.entry);
  }

  unuse(entry) {
    entry.users--;
    if (entry.users > 0) return;
    this.templates.delete(entry.id);
    entry.resource?.destroy();
  }

  destroy() {
    for (const entityId of [...this.seats.keys()]) this.release(entityId);
    for (const entry of this.templates.values()) entry.resource?.destroy();
    this.templates.clear();
    this.failures.clear();
  }
}
