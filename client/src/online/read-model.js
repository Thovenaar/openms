const MAX_VIEW_NODES = 100000;

/** Freeze protocol-owned trees without recursion or mutable aliases into UI state. */
export function freezeView(value) {
  const queue = [value];
  const seen = new Set();
  for (let index = 0; index < queue.length; index++) {
    if (queue.length > MAX_VIEW_NODES) {
      throw new Error("Online view exceeds node limit");
    }
    const node = queue[index];
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    for (const child of Object.values(node)) {
      if (child && typeof child === "object") queue.push(child);
    }
    Object.freeze(node);
  }
  return value;
}

/** Public appearance only; never creates a writable profile or a save target. */
export function makeAppearanceProfile(appearance) {
  if (!appearance || ![0, 1].includes(appearance.gender)) {
    throw new Error("Missing authoritative avatar appearance");
  }
  return freezeView({
    name: appearance.name,
    gender: appearance.gender,
    appearance: {
      skin: appearance.skin,
      face: appearance.face,
      hair: appearance.hair,
    },
    equipment: appearance.equipment.map((item) => ({
      id: item.templateId,
      slot: -item.slot,
    })),
  });
}

/** Native profile data is validated at assembly and remains exclusively server owned. */
export function makeViewProfile(snapshot, catalog) {
  if (
    !snapshot?.presentation?.profile ||
    !snapshot.self ||
    !snapshot.inventory ||
    !snapshot.progress
  ) {
    throw new Error("Complete online native presentation required");
  }
  if (catalog && catalog.schemaVersion !== 2) {
    throw new Error("Unsupported presentation catalog");
  }
  return freezeView(snapshot.presentation.profile);
}

/** Explicitly separate, nonpersistent browser presentation preferences. */
export function createLocalPreferences() {
  return {
    camera: "follow",
    geometry: false,
    muted: false,
    volume: 1,
    windows: Object.create(null),
  };
}

/** Apply closed entity deltas; no economy or profile mutation channel exists here. */
export function applyEntityChanges(model, message) {
  const entities = new Map();
  for (const entity of model.entities) entities.set(entity.id, entity);
  let self = model.self;
  for (const change of message.changes) {
    if (change.kind === "remove") {
      if (change.entityId === self.entity.id) {
        throw new Error("Authoritative self removed without transition");
      }
      entities.delete(change.entityId);
    } else {
      entities.set(change.entity.id, change.entity);
      if (change.entity.id === self.entity.id) {
        self = { ...self, entity: change.entity };
      }
    }
  }
  if (entities.size > 2048) throw new Error("Online entity capacity exceeded");
  return freezeView({
    ...model,
    self,
    entities: [...entities.values()],
    serverTick: message.serverTick,
    snapshotId: message.snapshotId,
    eventSeq: message.eventSeq,
    ackInputSeq: message.ackInputSeq,
  });
}
