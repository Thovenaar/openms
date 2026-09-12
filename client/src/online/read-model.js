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

function itemView(item) {
  return {
    uid: item.id,
    id: item.templateId,
    count: item.quantity,
    slot:
      item.location.kind === "equipped"
        ? -item.location.slot
        : item.location.slot,
    tab: item.location.kind === "inventory" ? item.location.tab : "equip",
    revision: item.revision,
    upgrade: item.equipment
      ? {
          slots: item.equipment.upgradesRemaining,
          successes: item.equipment.upgradesUsed,
          stats: Object.fromEntries(
            item.equipment.stats.map((stat) => [stat.key, stat.value]),
          ),
        }
      : null,
  };
}

function skillViews(progress) {
  const skills = Object.create(null);
  for (const skill of progress.skills) {
    skills[skill.id] = {
      level: skill.rank,
      masterLevel: skill.mastery,
      cooldownUntil: skill.cooldownUntil,
    };
  }
  return skills;
}

function questViews(progress) {
  const quests = Object.create(null);
  for (const quest of progress.quests) {
    quests[quest.id] = {
      state: quest.state === "active" ? 1 : 2,
      ready: quest.ready,
      revision: quest.revision,
      objectives: quest.objectives,
    };
  }
  return quests;
}

/** Convert only server observations. Catalog is immutable presentation metadata, not authority. */
export function makeViewProfile(snapshot, catalog) {
  if (!snapshot?.self || !snapshot.inventory || !snapshot.progress) {
    throw new Error("Complete online snapshot required");
  }
  if (catalog && catalog.schemaVersion !== 2) {
    throw new Error("Unsupported presentation catalog");
  }
  const self = snapshot.self;
  const appearance = makeAppearanceProfile(self.entity.appearance);
  const inventory = [],
    equipment = [];
  for (const item of snapshot.inventory.items) {
    (item.location.kind === "equipped" ? equipment : inventory).push(
      itemView(item),
    );
  }
  const skills = skillViews(snapshot.progress);
  const quests = questViews(snapshot.progress);
  return freezeView({
    ...appearance,
    hp: self.hp,
    mp: self.mp,
    maxHP: self.maxHp,
    maxMP: self.maxMp,
    job: self.job,
    level: self.level,
    exp: self.exp,
    remainingAp: self.ap,
    remainingSp: [...self.sp],
    str: self.stats.str,
    dex: self.stats.dex,
    int: self.stats.int,
    luk: self.stats.luk,
    meso: snapshot.inventory.mesos,
    inventory,
    equipment,
    inventorySlots: ["equip", "use", "setup", "etc", "cash"].map(
      (tab) => snapshot.inventory.capacities[tab],
    ),
    skills,
    quests,
    effects: self.effects,
    location: {
      mapId: snapshot.field.mapId,
      x: self.entity.position.x,
      y: self.entity.position.y,
    },
    revisions: snapshot.revisions,
  });
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
