// Original00443e60: ball/0..2 tiles,48px spacing, integer-degree rotation, no stretching.
// Constants are retained in native-skills-chain-beam-instructions.txt and chain-status-evidence.json.
const PATHS = ["ball/0", "ball/1", "ball/2"];
const MAX_TILED_SLOTS = 4096;
const TILE_SPACING = 48;
const DEGREES = 57.29579143313326;
const RADIANS = 0.01745328888888889;

export class SkillChainPresentation {
  constructor(resources, random = Math.random) {
    this.resources = resources;
    this.random = random;
    this.sequences = new Map();
    this.variants = new Uint8Array(0);
    this.needed = new Uint16Array(PATHS.length);
    this.position = { x: 0, y: 0 };
    this.options = { follow: false, facing: -1, durationMs: 0 };
    this.geometry = { x: 0, y: 0, cosine: 1, sine: 0, angle: 0, count: 0 };
  }

  async prepare(skill, field) {
    const capacity = this.capacity(skill, field);
    const sequences = [];
    for (const path of PATHS) {
      sequences.push(
        await this.resources.acquireSequence(skill, path, capacity),
      );
    }
    this.sequences.set(skill.id, sequences);
  }

  /** All native body frames are already bounded/validated by OfflineMobs before preparation. */
  maxBodyExtent(field) {
    const extent = { x: 0, y: 0 };
    const templates = new Set();
    for (const mob of field.mobs) templates.add(mob.template);
    for (const template of templates) {
      for (const action of Object.values(template.actions)) {
        for (const frame of action.frames) {
          const body = frame.body;
          if (!body) continue;
          extent.x = Math.max(
            extent.x,
            Math.abs(body.left),
            Math.abs(body.right),
          );
          extent.y = Math.max(
            extent.y,
            Math.abs(body.top),
            Math.abs(body.bottom),
          );
        }
      }
    }
    return extent;
  }

  capacity(skill, field) {
    const extent = this.maxBodyExtent(field);
    // Body intersection precedes center-distance selection: include both center offsets and the contacted edge.
    const reach = skill.id === 15111006 ? 150 : 300;
    const distance = Math.ceil(
      Math.hypot(reach + extent.x * 3, 150 + extent.y * 3),
    );
    const tiles = Math.trunc(distance / TILE_SPACING) + 1;
    // Spark retains each beam's impact slot through travel;120 live impacts is its source-owner ceiling.
    // Lightning releases damage slots at launch, but its native100ms stages and actor pose bound live beams.
    const record = field.skillCombat.prepared.get(skill.id);
    let beams = field.skillCombat.shots.length;
    if (skill.id === 2221006) {
      if (!(record.duration > 0)) {
        throw new Error("Native chain beam has no original actor timing");
      }
      const lifetime = (record.info.mobCount - 1) * 100 + 270;
      const casts = Math.ceil(lifetime / record.duration) + 2;
      beams = casts * Math.min(record.info.mobCount, 3);
    }
    const capacity = tiles * beams;
    if (capacity > MAX_TILED_SLOTS) {
      throw new Error(
        "Original field chain geometry exceeds tiled visual budget",
      );
    }
    if (tiles > this.variants.length) this.variants = new Uint8Array(tiles);
    return capacity;
  }

  place(shot) {
    let x1 = shot.startX,
      y1 = shot.startY,
      x2 = shot.endX,
      y2 = shot.endY;
    if (x2 < x1) {
      x1 = shot.endX;
      y1 = shot.endY;
      x2 = shot.startX;
      y2 = shot.startY;
    }
    const dx = x2 - x1,
      dy = y2 - y1;
    const degrees =
      dx === 0 ? (dy > 0 ? 90 : 270) : Math.trunc(Math.atan(dy / dx) * DEGREES);
    const geometry = this.geometry;
    geometry.count =
      Math.trunc(Math.trunc(Math.hypot(dx, dy)) / TILE_SPACING) + 1;
    if (geometry.count > this.variants.length) {
      throw new Error("Native chain beam exceeds prepared field geometry");
    }
    geometry.x = (x1 + x2) / 2;
    geometry.y = (y1 + y2) / 2;
    geometry.angle = degrees * RADIANS;
    geometry.cosine = Math.cos(Math.abs(degrees) * RADIANS);
    geometry.sine = Math.sin(geometry.angle);
  }

  selectVariants(sequences) {
    this.needed.fill(0);
    for (let index = 0; index < this.geometry.count; index++) {
      const variant = Math.trunc(this.random() * 0x100000000) % PATHS.length;
      this.variants[index] = variant;
      this.needed[variant]++;
    }
    for (let variant = 0; variant < PATHS.length; variant++) {
      if (!this.resources.hasSlots(sequences[variant], this.needed[variant])) {
        throw new Error("Native chain beam visual pool exhausted");
      }
    }
  }

  play(shot) {
    const sequences = this.sequences.get(shot.skill.id);
    if (!sequences) {
      throw new Error("Native chain beam variants were not prepared");
    }
    this.place(shot);
    this.selectVariants(sequences);
    const geometry = this.geometry;
    this.options.durationMs = shot.duration;
    for (let index = 0; index < geometry.count; index++) {
      const distance = (index - Math.trunc(geometry.count / 2)) * TILE_SPACING;
      this.position.x = Math.trunc(geometry.x + distance * geometry.cosine);
      this.position.y = Math.trunc(geometry.y + distance * geometry.sine);
      const slot = this.resources.playSequence(
        sequences[this.variants[index]],
        this.position,
        this.options,
      );
      if (!slot) {
        throw new Error("Admitted native chain beam tile slot unavailable");
      }
      slot.target = null;
      slot.animation.container.rotation = geometry.angle;
      slot.animation.container.scale.set(1, 1);
    }
    return null;
  }
}
