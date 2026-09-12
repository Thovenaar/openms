const MAX_TELEVISIONS = 128;
const MAX_PROGRAMS = 32;

/** Native006d089a: choose one packaged ad on NPC creation, loop it; TVoff is once. */
function channels(records, lifeSlots) {
  if (!Array.isArray(records) || records.length > MAX_TELEVISIONS) {
    throw new Error("Invalid MapleTV controller count");
  }
  const result = [];
  const owners = new Set();
  for (const record of records) {
    const owner = lifeSlots.get(record.owner);
    validateTelevision(record, owner, owners);
    owners.add(record.owner);
    // Browser presentation RNG, not a reconstructed original RNG sequence or broadcast.
    const program =
      record.programs[Math.floor(Math.random() * record.programs.length)];
    result.push(
      {
        id: record.media,
        owner,
        action: program,
        playback: "loop",
        entity: null,
      },
      {
        id: record.message,
        owner,
        action: "TVoff",
        playback: "once",
        entity: null,
      },
    );
  }
  for (const slot of lifeSlots.values()) {
    if (slot.template.info.MapleTV && !owners.has(slot.record.id)) {
      throw new Error(
        "MapleTV artwork is missing; re-extract the original field assets",
      );
    }
  }
  return result;
}

function validateTelevision(record, owner, owners) {
  if (
    !owner?.template.info.MapleTV ||
    owners.has(record.owner) ||
    record.media !== `${record.owner}:mapletv:media` ||
    record.message !== `${record.owner}:mapletv:message` ||
    !Array.isArray(record.programs) ||
    !record.programs.length ||
    record.programs.length > MAX_PROGRAMS
  ) {
    throw new Error("Invalid MapleTV controller");
  }
  for (let index = 0; index < record.programs.length; index++) {
    if (record.programs[index] !== String(index)) {
      throw new Error("Invalid MapleTV program index");
    }
  }
}

/** Owns only bounded playback state; normal field regions own sprites/atlases and ticking. */
export class MapleTVSystem {
  constructor(scene, lifeSlots) {
    this.scene = scene;
    this.elapsedMs = 0;
    this.channels = channels(scene.manifest.life.mapleTV ?? [], lifeSlots);
  }

  /** Retain the chosen program/phase across region recreation without a second texture lease. */
  refresh() {
    for (const channel of this.channels) {
      const entity = this.scene.byId.get(channel.id) ?? null;
      if (channel.entity === entity) continue;
      channel.entity = entity;
      if (!entity) continue;
      entity.setAction(channel.action, channel.playback);
      entity.advance(this.elapsedMs);
      entity.container.eventMode = "none";
    }
  }

  /** Called after the life slots have applied authored-hide and preview visibility. */
  update(ms) {
    this.elapsedMs += ms;
    for (const channel of this.channels) {
      const entity = channel.entity;
      if (!entity || entity.container.destroyed) continue;
      const owner = channel.owner.entity;
      entity.container.visible =
        !!owner && !owner.container.destroyed && owner.container.visible;
    }
  }

  snapshot() {
    return this.channels.map((channel) => ({
      id: channel.id,
      action: channel.action,
      playback: channel.playback,
      frame: channel.entity?.frame ?? null,
      elapsedMs: this.elapsedMs,
      resident: !!channel.entity && !channel.entity.container.destroyed,
      broadcast: false,
    }));
  }

  destroy() {
    this.channels.length = 0;
    this.scene = null;
  }
}
