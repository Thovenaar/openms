import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";

const PET_SLOTS = 3;
const TRAIL_SIZE = 128;
const TRAIL_SPACING = 12;
const PET_QUANTUM_MS = 30; //0070403d/009b16e8 original fixed pet update quantum.
const DESTROY_DISPLAY = Object.freeze({ children: true });

function ownedPet(profile, itemUid) {
  for (const pet of profile.pets) {
    if (pet.itemUid === itemUid) return pet;
  }
  return null;
}

/** Local deterministic path-follow policy: delayed samples of the actual collision-resolved caster path.
 * The original CPet physics vtable's pursuit constants are not asserted as recovered.
 */
export class PetPresentation {
  constructor(system) {
    this.system = system;
    this.records = new Map();
    this.abort = new AbortController();
    this.trailX = new Float64Array(TRAIL_SIZE);
    this.trailY = new Float64Array(TRAIL_SIZE);
    this.trailFacing = new Int8Array(TRAIL_SIZE);
    this.cursor = 0;
    this.elapsed = 0;
    this.initialized = false;
  }

  async prepare(itemUid) {
    const profile = this.system.store.profile;
    const item = profile.inventory.find((entry) => entry.uid === itemUid);
    if (!item) throw new Error("The owned pet item is unavailable");
    const previous = this.records.get(itemUid);
    if (previous?.itemId === item.id) return;
    this.releaseUnused(itemUid);
    if (previous) {
      previous.animation.container.destroy(DESTROY_DISPLAY);
      previous.owner.destroy();
      this.records.delete(itemUid);
    }
    const descriptor =
      this.system.fullCatalog.ui.skillUtility?.pets[item.id]?.bundle;
    if (!descriptor) {
      throw new Error("Original pet animation bundle is unavailable");
    }
    const owner = await loadVisualBundle(
      descriptor,
      this.system.hooks.services,
      this.abort.signal,
    );
    const animation = new EntityAnimation(
      owner.manifest.entities[0],
      owner.textures,
    );
    animation.container.visible = false;
    this.system.scene.overlays.addChild(animation.container);
    this.records.set(itemUid, {
      owner,
      animation,
      itemId: item.id,
      x: 0,
      y: 0,
    });
  }

  async prepareSummoned() {
    for (const pet of this.system.store.profile.pets) {
      if (pet.summonedSlot !== null) await this.prepare(pet.itemUid);
    }
  }

  releaseUnused(keepUid) {
    for (const [uid, record] of this.records) {
      const pet = ownedPet(this.system.store.profile, uid);
      if (uid === keepUid || (pet && pet.summonedSlot !== null)) continue;
      record.animation.container.destroy(DESTROY_DISPLAY);
      record.owner.destroy();
      this.records.delete(uid);
    }
    if (this.records.size > PET_SLOTS) {
      throw new Error("Pet animation residency exceeds live slot bound");
    }
  }

  seedTrail() {
    const actor = this.system.scene.simulation;
    this.trailX.fill(actor.x);
    this.trailY.fill(actor.y);
    this.trailFacing.fill(actor.facing);
    this.initialized = true;
  }

  step(ms) {
    if (!this.initialized) this.seedTrail();
    this.elapsed += ms;
    const steps = Math.floor(this.elapsed / PET_QUANTUM_MS);
    if (steps > TRAIL_SIZE) {
      throw new Error("Pet simulation catch-up exceeds path bound");
    }
    this.elapsed -= steps * PET_QUANTUM_MS;
    const actor = this.system.scene.simulation;
    for (let step = 0; step < steps; step++) {
      this.cursor = (this.cursor + 1) % TRAIL_SIZE;
      this.trailX[this.cursor] = actor.x;
      this.trailY[this.cursor] = actor.y;
      this.trailFacing[this.cursor] = actor.facing;
    }
    const profile = this.system.store.profile;
    const now = Date.now();
    for (const [itemUid, record] of this.records) {
      const pet = ownedPet(profile, itemUid);
      const slot = pet?.summonedSlot;
      const visible =
        profile.hp > 0 &&
        slot !== null &&
        slot !== undefined &&
        slot < PET_SLOTS &&
        (pet.expiresAt === null || pet.expiresAt > now);
      record.animation.container.visible = visible;
      if (visible) this.position(record, slot, ms);
    }
  }

  position(record, slot, ms) {
    const index =
      (this.cursor + TRAIL_SIZE - (slot + 1) * TRAIL_SPACING) % TRAIL_SIZE;
    const x = this.trailX[index],
      y = this.trailY[index];
    const moving = record.x !== x || record.y !== y;
    const actions = record.animation.actions;
    const stand = actions.has("stand0") ? "stand0" : "stand1";
    const move = actions.has("move") ? "move" : stand;
    record.animation.setAction(moving ? move : stand);
    record.animation.setPosition(x, y);
    record.animation.container.scale.x = this.trailFacing[index] > 0 ? -1 : 1;
    record.animation.advance(ms);
    record.x = x;
    record.y = y;
  }

  destroy() {
    this.abort.abort();
    for (const record of this.records.values()) {
      record.animation.container.destroy(DESTROY_DISPLAY);
      record.owner.destroy();
    }
    this.records.clear();
  }
}
