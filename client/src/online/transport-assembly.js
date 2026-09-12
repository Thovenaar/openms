import { decodeNativePresentation } from "../../../shared/native-presentation.js";
import { domainEventSchema } from "../../../shared/protocol.js";
const MAX_PARTS = 64;
const MAX_BYTES = 1024 * 1024;
const DEADLINE_MS = 5000;
const MAX_ENTITIES = 2048;

function invalid(message) {
  throw new Error(`Invalid online assembly: ${message}`);
}

/** Owns one bounded multipart replacement; incomplete data is never published. */
export class MultipartAssembly {
  constructor() {
    this.pending = null;
  }

  clear() {
    this.pending = null;
  }

  check(now) {
    if (this.pending && now > this.pending.deadline) {
      invalid("deadline exceeded");
    }
  }

  admit(message, now, shop) {
    this.check(now);
    const page = shop ? message.event : message;
    if (page.parts < 1 || page.parts > MAX_PARTS || page.part >= page.parts) {
      invalid("part bounds");
    }
    const identity = shop ? page.shopSession : message.snapshotId;
    if (!this.pending) {
      this.pending = {
        identity,
        first: message,
        parts: new Array(page.parts),
        count: 0,
        bytes: 0,
        deadline: now + DEADLINE_MS,
      };
    }
    const pending = this.pending;
    if (pending.identity !== identity || pending.parts.length !== page.parts) {
      invalid("interleaved identities");
    }
    validateVector(pending.first, message, shop);
    return page;
  }

  add(message, bytes, now, shop = false) {
    const page = this.admit(message, now, shop);
    const pending = this.pending;
    if (pending.parts[page.part]) invalid("duplicate part");
    pending.bytes += bytes;
    if (pending.bytes > MAX_BYTES) invalid("byte capacity exceeded");
    pending.parts[page.part] = shop ? page : message.view;
    pending.count++;
    if (pending.count !== pending.parts.length) return null;
    this.pending = null;
    return shop ? assembleShop(pending) : assembleSnapshot(pending);
  }
}

function validateVector(first, message, shop) {
  if (shop) {
    if (
      first.event.revision !== message.event.revision ||
      first.event.npcId !== message.event.npcId
    ) {
      invalid("shop revision mismatch");
    }
  } else if (
    first.fieldEpoch !== message.fieldEpoch ||
    first.eventSeq !== message.eventSeq ||
    first.serverTick !== message.serverTick ||
    first.ackInputSeq !== message.ackInputSeq
  ) {
    invalid("snapshot vector mismatch");
  }
}

function unique(items, key, maximum) {
  if (items.length > maximum) invalid("collection capacity exceeded");
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item[key])) invalid("duplicate identifier");
    ids.add(item[key]);
  }
}

function assembleShop(pending) {
  const rows = [];
  for (const part of pending.parts) rows.push(...part.rows);
  unique(rows, "rowId", MAX_PARTS * 128);
  return { ...pending.first.event, part: 0, parts: 1, rows };
}

function collectSnapshot(parts) {
  let field = null;
  const inventory = { items: [], mesos: null, capacities: null };
  let hasProgress = false;
  let hasEntities = false;
  const native = [];
  const entities = [],
    quests = [],
    skills = [];
  for (const part of parts) {
    if (part.kind === "field") {
      if (field) invalid("duplicate field");
      field = part;
    } else if (part.kind === "entities") {
      hasEntities = true;
      entities.push(...part.entities);
    } else if (part.kind === "inventory") {
      mergeInventory(inventory, part);
    } else if (part.kind === "progress") {
      hasProgress = true;
      quests.push(...part.quests);
      skills.push(...part.skills);
    } else if (part.kind === "native-presentation") {
      native.push(part);
    }
  }
  if (!field || !hasEntities || inventory.mesos === null || !hasProgress) {
    invalid("incomplete snapshot kinds");
  }
  return {
    field,
    entities,
    inventory,
    progress: { quests, skills },
    presentation: assembleNative(native),
  };
}

function assembleNative(parts) {
  if (!parts.length || parts.length !== parts[0].total) {
    invalid("incomplete native presentation");
  }
  const chunks = new Array(parts.length);
  for (const part of parts) {
    if (
      part.total !== parts.length ||
      part.index >= parts.length ||
      chunks[part.index] !== undefined
    ) {
      invalid("invalid native presentation pages");
    }
    chunks[part.index] = part.data;
  }
  return decodeNativePresentation(chunks.join(""), domainEventSchema);
}

function mergeInventory(inventory, part) {
  if (inventory.mesos !== null && inventory.mesos !== part.mesos) {
    invalid("currency mismatch");
  }
  inventory.mesos = part.mesos;
  if (inventory.capacities) {
    for (const key of Object.keys(inventory.capacities)) {
      if (inventory.capacities[key] !== part.capacities[key]) {
        invalid("capacity mismatch");
      }
    }
  }
  inventory.capacities = part.capacities;
  inventory.items.push(...part.items);
}

function assembleSnapshot(pending) {
  const { field, entities, inventory, progress, presentation } =
    collectSnapshot(pending.parts);
  if (field.field.fieldEpoch !== pending.first.fieldEpoch) {
    invalid("field epoch mismatch");
  }
  unique(entities, "id", MAX_ENTITIES);
  unique(inventory.items, "id", MAX_PARTS * 128);
  unique(progress.quests, "id", MAX_PARTS * 128);
  unique(progress.skills, "id", MAX_PARTS * 128);
  validateSlots(inventory.items, inventory.capacities);
  validateNativeCore(presentation, field, inventory, progress);
  return {
    field: field.field,
    self: field.self,
    entities,
    inventory,
    progress,
    presentation,
    revisions: {
      character: field.characterRevision,
      inventory: field.inventoryRevision,
      social: field.socialRevision,
      ...presentation.revisions,
    },
    snapshotId: pending.first.snapshotId,
    fieldEpoch: pending.first.fieldEpoch,
    serverTick: pending.first.serverTick,
    eventSeq: pending.first.eventSeq,
    ackInputSeq: pending.first.ackInputSeq,
  };
}

function validateNativeCore(presentation, field, inventory, progress) {
  const profile = presentation.profile;
  validateNativeCharacter(profile, field, inventory.mesos);
  validateNativeItems(profile, inventory.items);
  validateNativeProgress(profile, progress);
}

function validateNativeCharacter(profile, field, mesos) {
  const self = field.self;
  if (
    profile.hp !== self.hp ||
    profile.mp !== self.mp ||
    profile.maxHP !== self.maxHp ||
    profile.maxMP !== self.maxMp ||
    profile.meso !== mesos ||
    profile.name !== self.entity.appearance.name ||
    Number(profile.location.mapId) !== field.field.mapId
  ) {
    invalid("native character mismatch");
  }
}

function validateNativeItems(profile, observed) {
  const items = new Map();
  for (const item of profile.inventory) {
    items.set(item.uid, { item, equipped: false });
  }
  for (const item of profile.equipment) {
    items.set(item.uid, { item, equipped: true });
  }
  if (items.size !== observed.length) invalid("native inventory mismatch");
  for (const wire of observed) validateNativeItem(items.get(wire.id), wire);
}

function validateNativeItem(owned, wire) {
  if (
    !owned ||
    owned.item.id !== wire.templateId ||
    owned.item.count !== wire.quantity ||
    Math.abs(owned.item.slot) !== wire.location.slot ||
    owned.equipped !== (wire.location.kind === "equipped")
  ) {
    invalid("native item mismatch");
  }
}

function validateNativeProgress(profile, progress) {
  if (Object.keys(profile.skills).length !== progress.skills.length) {
    invalid("native skills mismatch");
  }
  for (const skill of progress.skills) {
    const learned = profile.skills[skill.id];
    if (
      !learned ||
      learned.level !== skill.rank ||
      learned.masterLevel !== skill.mastery
    ) {
      invalid("native skill mismatch");
    }
  }
  for (const quest of progress.quests) {
    if (
      profile.quests[quest.id]?.state !== (quest.state === "active" ? 1 : 2)
    ) {
      invalid("native quest mismatch");
    }
  }
}

function validateSlots(items, capacities) {
  const slots = new Set();
  for (const item of items) {
    const location = item.location;
    if (
      location.slot < 1 ||
      (location.kind === "inventory" &&
        location.slot > capacities[location.tab])
    ) {
      invalid("slot outside capacity");
    }
    const key = `${location.kind}:${location.tab ?? ""}:${location.slot}`;
    if (slots.has(key)) invalid("duplicate occupied slot");
    slots.add(key);
  }
}
