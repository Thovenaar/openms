const LOOP = Object.freeze({ loop: true, follow: true });
const RECAST_GUARD_MS = 5000; // Cosmic SpecialMoveHandler135..154.
const DEPLOY_MS = 3000; // Cosmic Door127..140 original deployment lifetime.

/** Paired endpoints belong to the character session, never the static WZ portal list. */
export class SkillDoor {
  constructor(system) {
    this.system = system;
    this.skill = null;
    this.info = null;
    this.sequences = null;
    this.remainingMs = 0;
    this.elapsedMs = 0;
    this.source = { mapId: null, portalName: null, x: 0, y: 0 };
    this.town = { mapId: null, portalName: null, x: 0, y: 0 };
    this.visual = { x: 0, y: 0, facing: 1 };
    this.slot = null;
    this.pending = false;
    this.settled = this.onSettled.bind(this);
    this.failed = this.onFailed.bind(this);
  }

  prepare(skill, info, sequences) {
    this.skill = skill;
    this.info = info;
    this.sequences = sequences;
    this.bindVisual();
  }

  admissionError() {
    const sim = this.system.scene.simulation;
    const maps = this.system.fullCatalog.ui.skillWorld?.maps;
    const field = maps?.[this.mapId()];
    if (!field) return "Original field Door metadata is not prepared";
    if (field.fieldLimit & 8) return "Mystic Door is forbidden in this field";
    if (sim.state !== "ground" || sim.foothold.dy !== 0) {
      return "Mystic Door requires level ground";
    }
    if (this.remainingMs > 0 && this.elapsedMs <= RECAST_GUARD_MS) {
      return "Mystic Door cannot be replaced during deployment";
    }
    if (!maps[field.returnMap]?.doors.length) {
      return "Return town has no original available Door portal";
    }
    return this.resourceError();
  }

  resourceError() {
    if (!this.sequences?.has("mDoor") || !this.sequences?.has("cDoor")) {
      return "Original Door artwork is not prepared";
    }
    if (!this.system.hooks.travelDoor) {
      return "Atomic Door travel is unavailable";
    }
    return null;
  }

  cast() {
    this.cancel();
    const sim = this.system.scene.simulation;
    const maps = this.system.fullCatalog.ui.skillWorld.maps;
    const mapId = this.mapId();
    const field = maps[mapId];
    const portal = maps[field.returnMap].doors[0];
    this.source.mapId = mapId;
    this.source.x = sim.x;
    this.source.y = sim.y;
    this.town.mapId = field.returnMap;
    this.town.portalName = portal.name;
    this.town.x = portal.x;
    this.town.y = portal.y;
    this.remainingMs = this.info.time * 1000;
    this.elapsedMs = 0;
    this.bindVisual();
  }

  mapId() {
    return String(this.system.scene.manifest.id).padStart(9, "0");
  }

  endpoint() {
    if (this.remainingMs <= 0) return null;
    const id = this.mapId();
    if (id === this.source.mapId) return this.source;
    if (id === this.town.mapId) return this.town;
    return null;
  }

  bindVisual() {
    this.system.resources.stop(this.slot);
    this.slot = null;
    const endpoint = this.endpoint();
    if (!endpoint || !this.sequences) return;
    this.visual.x = endpoint.x;
    this.visual.y = endpoint.y;
    const sequence = this.sequences.get(
      endpoint === this.source ? "mDoor" : "cDoor",
    );
    if (sequence) {
      this.slot = this.system.resources.playSequence(
        sequence,
        this.visual,
        LOOP,
      );
    }
  }

  use() {
    const endpoint = this.endpoint();
    if (!endpoint || this.pending || this.elapsedMs < DEPLOY_MS) return false;
    const sim = this.system.scene.simulation;
    if (
      Math.abs(sim.x - endpoint.x) >= 20 ||
      Math.abs(sim.y - endpoint.y) >= 50
    ) {
      return false;
    }
    this.pending = true;
    const destination = endpoint === this.source ? this.town : this.source;
    this.system.hooks.travelDoor(destination).then(this.settled, this.failed);
    return true;
  }

  onSettled() {
    this.pending = false;
  }
  onFailed(error) {
    this.pending = false;
    this.system.hooks.report(error);
  }

  step(ms) {
    if (this.remainingMs <= 0) return;
    this.remainingMs = Math.max(0, this.remainingMs - ms);
    this.elapsedMs += ms;
    if (this.remainingMs === 0 || this.system.level(2311002) <= 0) {
      this.cancel();
    }
  }

  inherit(previous) {
    if (previous.remainingMs <= 0) return;
    Object.assign(this.source, previous.source);
    Object.assign(this.town, previous.town);
    this.remainingMs = previous.remainingMs;
    this.elapsedMs = previous.elapsedMs;
    this.bindVisual();
  }

  cancel() {
    this.remainingMs = 0;
    this.elapsedMs = 0;
    this.system.resources.stop(this.slot);
    this.slot = null;
  }
}
