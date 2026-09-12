import { createMobs } from "../combat/offline-mobs.js";
import { manifest as validateManifest } from "../rendering/stream-validation.js";
import { check } from "../rendering/stream-network.js";

// Explicit inspection policy: added mobs live in this field and never enter a save.
const MAX_DEVELOPMENT_MOBS = 128;
const MAX_FIELD_MOBS = 4096;
const FIRST_DEVELOPMENT_ID = 1000000;
const SPAWN_OFFSET = 60;

/** Build one original-template placement on the player's current authored foothold. */
function spawnRecord(entry, simulation, serial) {
  const foothold = simulation.foothold;
  const x = Math.round(
    Math.max(
      foothold.x1,
      Math.min(foothold.x2, simulation.x + simulation.facing * SPAWN_OFFSET),
    ),
  );
  const y = Math.round(
    foothold.y1 + ((x - foothold.x1) * foothold.dy) / foothold.dx,
  );
  return {
    id: `life:${FIRST_DEVELOPMENT_ID + serial}`,
    template: entry.template,
    kind: "mob",
    source: "development-inspection",
    authored: {
      type: "m",
      id: String(entry.id).padStart(7, "0"),
      x,
      y,
      cy: y,
      fh: foothold.id,
      rx0: foothold.x1,
      rx1: foothold.x2,
      f: simulation.facing > 0 ? 0 : 1,
      hide: 0,
      mobTime: -1,
    },
  };
}

/** Per-field producer. Prepared original mobs join ordinary combat, drops and quests. */
export class DevelopmentMonsterSpawner {
  constructor(field) {
    this.field = field;
    this.pending = false;
    this.serial = 0;
    this.destroyed = false;
    this.controller = new AbortController();
  }

  availability() {
    const { owner, scene, gameplay } = this.field;
    let reason = null;
    if (this.destroyed || scene !== owner.scene || !gameplay?.prepared) {
      reason = "No prepared current field.";
    } else if (
      this.pending ||
      owner.isOperationPending() ||
      owner.hooks.isBlocked() ||
      owner.ui.blocksGameplay()
    ) {
      reason = "Finish the current gameplay or inspection operation.";
    } else {
      reason = this.placementError();
    }
    return { available: reason === null, reason };
  }

  placementError() {
    const { scene, gameplay } = this.field;
    if (gameplay.dead) return "Revive before spawning monsters.";
    if (
      scene.simulation.state !== "ground" ||
      !(scene.simulation.foothold?.dx > 0)
    ) {
      return "Stand on a foothold before spawning a monster.";
    }
    if (
      this.serial >= MAX_DEVELOPMENT_MOBS ||
      gameplay.mobs.length >= MAX_FIELD_MOBS
    ) {
      return "This field reached its development monster limit; reload to clear spawned monsters.";
    }
    return null;
  }

  /** @param {number} id Original packaged Mob.wz template identity. */
  async spawn(id) {
    const availability = this.availability();
    if (!availability.available) {
      return { ok: false, reason: availability.reason };
    }
    const { owner, scene, gameplay } = this.field;
    const entry = owner.catalog.monsters?.[id];
    if (!Number.isSafeInteger(id) || id <= 0 || !entry) {
      throw new Error("Choose an original packaged monster template.");
    }
    const profile = owner.store.profile;
    const record = spawnRecord(entry, scene.simulation, this.serial);
    this.pending = true;
    owner.hooks.clearInput();
    let slot = null;
    try {
      const source = await this.sourceManifest(entry);
      const mob = this.createCandidate(source, record);
      slot = await gameplay.renderer.prepareSpawn(
        mob,
        source,
        this.controller.signal,
      );
      await owner.audio.prepareMobSounds([mob], this.controller.signal);
      this.assertCurrent(profile);
      this.field.combat.prepareSkillCapacity(
        this.field.skills,
        gameplay.mobs.length + 1,
      );
      gameplay.addDevelopmentMob(mob);
      this.serial++;
      return { ok: true, id: mob.id, templateId: id };
    } finally {
      if (slot) slot.reserved--;
      this.pending = false;
    }
  }

  async sourceManifest(entry) {
    const { owner, scene } = this.field;
    if (entry.mapId === scene.manifest.id) return scene.manifest;
    const descriptor = owner.catalog.maps[entry.mapId];
    if (!descriptor) throw new Error("Monster source map is not packaged.");
    const source = validateManifest(
      await owner.services.network.json(descriptor, this.controller.signal),
    );
    if (source.id !== entry.mapId) {
      throw new Error("Monster source map identity mismatch.");
    }
    return source;
  }

  createCandidate(source, record) {
    const template = source.life.templates[record.template];
    if (
      !template ||
      template.kind !== "mob" ||
      template.originalId !== record.authored.id
    ) {
      throw new Error("Monster template identity mismatch.");
    }
    const mobs = createMobs(
      { placements: [record], templates: { [record.template]: template } },
      this.field.scene.simulation,
    );
    const mob = mobs[0];
    if (!mob.active) {
      throw new Error(
        `Monster cannot participate in combat: ${mob.inactiveReason}`,
      );
    }
    mob.developmentSpawn = true;
    // Same original 800ms new-spawn opacity path used by respawned mobs.
    mob.spawnMs = 0;
    mob.opacity = 0;
    return mob;
  }

  assertCurrent(profile) {
    check(this.controller.signal);
    const { owner, scene, gameplay } = this.field;
    if (
      this.destroyed ||
      this.field.destroyed ||
      scene !== owner.scene ||
      gameplay.destroyed ||
      owner.store.profile !== profile
    ) {
      throw new Error(
        "Field or character changed while preparing the monster.",
      );
    }
  }

  destroy() {
    this.destroyed = true;
    this.controller.abort();
  }
}
