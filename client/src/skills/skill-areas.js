const MAX_TILES = 32;
const TILE_SPACING = 80; // Deterministic local coverage layout; every tile is original artwork.
const LOOP = Object.freeze({ loop: true, follow: true });

export function createArea(skill, info, sequences) {
  const width = info.rb.x - info.lt.x;
  const height = info.rb.y - info.lt.y;
  const columns = Math.max(1, Math.ceil(width / TILE_SPACING));
  const rows = Math.max(1, Math.ceil(height / TILE_SPACING));
  if (columns * rows > MAX_TILES) {
    throw new Error("Ground area tile bound exceeded");
  }
  const variants = [...sequences.entries()]
    .filter(([path]) => path.startsWith("tile/"))
    .map(([, sequence]) => sequence);
  if (!variants.length) {
    throw new Error("Original ground-area artwork is unavailable");
  }
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      tiles.push({
        x: 0,
        y: 0,
        facing: 1,
        slot: null,
        sequence: variants[tiles.length % variants.length],
        dx: info.lt.x + ((column + 0.5) * width) / columns,
        dy: info.lt.y + ((row + 0.5) * height) / rows,
      });
    }
  }
  return {
    skill,
    info,
    sequences,
    tiles,
    remainingMs: 0,
    nextMs: 2500,
    x: 0,
    y: 0,
    facing: 1,
    kind: "area",
    targetId: null,
  };
}

export class SkillAreas {
  constructor(system) {
    this.system = system;
    this.records = new Map();
  }

  cast(record, origin = this.system.scene.simulation) {
    this.stop(record);
    record.x = origin.x;
    record.y = origin.y;
    record.facing = origin.facing;
    record.remainingMs = record.info.time * 1000;
    record.nextMs = 2500;
    for (const tile of record.tiles) {
      tile.x = record.x + tile.dx;
      tile.y = record.y + tile.dy;
      tile.slot = this.system.resources.playSequence(tile.sequence, tile, LOOP);
    }
  }

  step(ms) {
    for (const record of this.records.values()) {
      if (record.remainingMs <= 0) continue;
      const elapsed = Math.min(ms, record.remainingMs);
      record.remainingMs -= elapsed;
      record.nextMs -= elapsed;
      if (record.nextMs <= 0 && record.skill.id !== 4221006) {
        this.system.hooks
          .gameplay()
          .externalSkillImpact(record.skill, record.info, record);
        record.nextMs += 2000;
      }
      if (record.remainingMs <= 0 || this.system.level(record.skill.id) <= 0) {
        this.stop(record);
      }
    }
  }

  protects(x, y) {
    const record = this.records.get(4221006);
    if (!record || record.remainingMs <= 0) return false;
    const dx = x - record.x;
    const dy = y - record.y;
    return (
      dx >= record.info.lt.x &&
      dx < record.info.rb.x &&
      dy >= record.info.lt.y &&
      dy < record.info.rb.y
    );
  }

  stop(record) {
    for (const tile of record.tiles) {
      this.system.resources.stop(tile.slot);
      tile.slot = null;
    }
    record.remainingMs = 0;
  }

  cancel(id) {
    const record = this.records.get(id);
    if (record) this.stop(record);
  }
  destroy() {
    for (const record of this.records.values()) this.stop(record);
    this.records.clear();
  }
}
