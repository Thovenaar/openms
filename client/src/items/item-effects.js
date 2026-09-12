import {
  configureTemporaryState,
  temporaryState,
} from "../skills/temporary-stats.js";
import { prepareItemConditions } from "./item-conditions.js";

const MAX_METADATA_FIELDS = 256;
const MAX_DURATION_MS = 2147483647; // Native temporary-stat duration is signed int32.
const RECOVERY_FIELDS = new Set(["hp", "mp", "hpR", "mpR"]);
const STAT_FIELDS = new Set([
  "pad",
  "pdd",
  "mad",
  "mdd",
  "acc",
  "eva",
  "speed",
  "jump",
]);
const CONSUME_GROUPS = new Set([200, 201, 202, 205, 221, 236, 238, 245]);
// Cosmic StatEffect.mapProtection and priority-source logic require separate local controllers.
const SPECIAL_SOURCES = new Set([
  2022001, 2022186, 2022040, 2022631, 2022632, 2022633,
]);
const PRESENTATION_FIELDS = new Set([
  "icon",
  "iconRaw",
  "price",
  "slotMax",
  "unitPrice",
  "notSale",
  "tradeBlock",
  "only",
  "soldInform",
  "accountSharable",
  "bigSize",
  "mcType",
]);
const UNAVAILABLE_FIELDS = Object.freeze({
  mad: "outgoing magic damage",
  defenseState: "monster status infliction resistance",
  respectPimmune: "physical immunity bypass",
  respectMimmune: "magic immunity bypass",
  respectFS: "foothold slip protection",
  thaw: "map cold/underwater damage protection",
  expinc: "pickup EXP producer (original spec has no timed EXP duration)",
  cp: "Monster Carnival points",
  nuffSkill: "Monster Carnival opponent debuff",
  poison: "poison cure",
  seal: "seal cure",
  darkness: "darkness cure",
  weakness: "weakness cure",
  curse: "curse cure",
  barrier: "mob-qualified barrier",
  mob: "mob-qualified item effect",
  padRate: "percentage physical attack",
  madRate: "percentage magic attack",
  pddRate: "percentage physical defense",
  mddRate: "percentage magic defense",
  accRate: "percentage accuracy",
  evaRate: "percentage avoidability",
  speedRate: "percentage movement",
  mhpR: "periodic HP recovery",
  mhpRRate: "periodic HP recovery rate",
  mmpR: "periodic MP recovery",
  mmpRRate: "periodic MP recovery rate",
  dojangshield: "Dojo shield",
  eventPoint: "event points",
  eventRate: "event rate",
});
const CARD_FLAGS = new Set(["mesoupbyitem", "itemupbyitem"]);
const CARD_PARAMETERS = new Set(["prob", "itemCode", "itemRange"]);
const PICKUP_FLAGS = new Set([
  "consumeOnPickup",
  "onlyPickup",
  "party",
  "mesoupbyitem",
]);

function fieldsOf(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid original ${path}`);
  }
  const fields = Object.keys(value);
  if (fields.length > MAX_METADATA_FIELDS) {
    throw new Error(`Original ${path} field budget exceeded`);
  }
  return fields;
}

function admittedCardInfo(info, field) {
  return (
    (field === "monsterBook" && info[field] === 1) ||
    (field === "mob" && Number.isSafeInteger(info[field]) && info[field] > 0)
  );
}

function admitInfo(item, card) {
  for (const field of fieldsOf(item.info, "item info")) {
    if (
      PRESENTATION_FIELDS.has(field) ||
      (field === "cash" && item.info[field] === 0)
    ) {
      continue;
    }
    if (card && admittedCardInfo(item.info, field)) continue;
    throw new Error(
      `Original item info.${field} has no local admission controller`,
    );
  }
  if (
    card &&
    (item.info.monsterBook !== 1 ||
      !Number.isSafeInteger(item.info.mob) ||
      item.info.mob <= 0)
  ) {
    throw new Error("Original monster book card identity is unavailable");
  }
}

/** Both Cosmic getInt(default) and getIntConvert accept authored decimal strings. */
function numberValue(value) {
  if (typeof value === "string" && /^-?\d{1,10}$/.test(value)) {
    value = Number(value);
  }
  return Number.isSafeInteger(value) ? value : null;
}

/** Cosmic ItemInformationProvider1693: either authored branch marks automatic pickup. */
export function isPickupItem(item) {
  return (
    numberValue(item?.spec?.consumeOnPickup) === 1 ||
    numberValue(item?.properties?.specEx?.consumeOnPickup) === 1
  );
}

function boundedValue(value, minimum, maximum) {
  return value >= minimum && value <= maximum ? value : null;
}

function recoveryValue(field, value) {
  const maximum = field === "hpR" || field === "mpR" ? 100 : 32767;
  return boundedValue(value, 0, maximum);
}

function effectValue(field, value) {
  value = numberValue(value);
  if (value === null) return null;
  if (STAT_FIELDS.has(field)) return boundedValue(value, -32768, 32767);
  if (field === "time") return boundedValue(value, 0, MAX_DURATION_MS);
  if (RECOVERY_FIELDS.has(field)) return recoveryValue(field, value);
  if (field === "prob") return boundedValue(value, 0, 100);
  if (PICKUP_FLAGS.has(field)) return boundedValue(value, 0, 1);
  if (field === "itemupbyitem") return boundedValue(value, 0, 3);
  if (field === "itemCode") return boundedValue(value, 1000000, 5999999);
  if (field === "itemRange") return boundedValue(value, 100, 599);
  return null;
}

function readSpec(item, card) {
  const specEx = item.properties?.specEx;
  for (const field of fieldsOf(item.properties, "item properties")) {
    if (field !== "specEx") {
      throw new Error(
        `Original item property ${field} has no local controller`,
      );
    }
  }
  // Cosmic ItemInformationProvider1302: specEx replaces spec; never merge them.
  const spec = specEx ?? item.spec;
  const fields = fieldsOf(spec, specEx ? "item specEx" : "item spec");
  const effect = {
    values: Object.create(null),
    spec: item.spec,
    specEx,
    state: null,
    conditions: prepareItemConditions(spec.con),
    unavailable: null,
    recovery: false,
    timed: false,
    card,
  };
  for (const field of fields) readEffectField(effect, field, spec[field]);
  if (effect.values.defenseAtt) effect.values.prob ??= 1;
  effect.unavailable ??= effect.conditions?.unavailable ?? null;
  return effect;
}

function retainEffectAvailability(effect, field, amount) {
  const defensePercent =
    field === "prob" && (effect.specEx ?? effect.spec).defenseAtt !== undefined;
  if (
    (CARD_FLAGS.has(field) || CARD_PARAMETERS.has(field)) &&
    !effect.card &&
    !defensePercent
  ) {
    effect.unavailable ??= `Original non-card ${field} controller is unavailable`;
  }
  if (field === "mad" && amount !== 0) {
    effect.unavailable ??= `Original ${UNAVAILABLE_FIELDS.mad} controller is unavailable`;
  }
}

function readEffectField(effect, field, authored) {
  if (field === "defenseAtt") {
    readDefenseElement(effect, authored);
    return;
  }
  if (field === "con") return;
  const amount = effectValue(field, authored);
  if (amount !== null) {
    effect.values[field] = amount;
    if (RECOVERY_FIELDS.has(field) && amount > 0) effect.recovery = true;
    if (STAT_FIELDS.has(field) && amount !== 0) effect.timed = true;
    if (CARD_FLAGS.has(field) && amount !== 0) effect.timed = true;
    retainEffectAvailability(effect, field, amount);
    return;
  }
  if (Object.hasOwn(UNAVAILABLE_FIELDS, field)) {
    effect.unavailable ??= `Original ${field}: ${UNAVAILABLE_FIELDS[field]} controller is unavailable`;
    return;
  }
  throw new Error(
    `Original item spec.${field} has an unsupported value or unrecovered controller`,
  );
}

function readDefenseElement(effect, authored) {
  //0095fa8b admits only I/F/L/S, not holy/darkness/physical elements.
  if (typeof authored !== "string" || !/^[IFLS]$/.test(authored)) {
    throw new Error("Original defenseAtt element is unavailable");
  }
  effect.values.defenseAtt = "IFLS".indexOf(authored) + 1;
  effect.timed = true;
}

function configureCard(effect) {
  const values = effect.values;
  if (!effect.card) return;
  if (values.consumeOnPickup !== 1) {
    throw new Error("Original monster card is not consume-on-pickup");
  }
  if (values.itemupbyitem === 2 && !values.itemCode) {
    throw new Error("Original item-rate card itemCode is missing");
  }
  if (values.itemupbyitem === 3 && !values.itemRange) {
    throw new Error("Original item-rate card itemRange is missing");
  }
  if (values.prob === undefined) values.prob = 1; // Cosmic StatEffect399..407.
}

function configureItemState(effect, itemId) {
  if (
    effect.timed &&
    (!Number.isInteger(effect.values.time) || effect.values.time < 16)
  ) {
    throw new Error(
      "Original timed item duration is missing or outside native overlay bounds",
    );
  }
  if (effect.values.time >= 16 && (effect.timed || effect.unavailable)) {
    effect.state = temporaryState("item", itemId);
    configureTemporaryState(effect.state, effect.values, effect.values.time);
    effect.state.conditions = effect.conditions;
    effect.state.unavailable = effect.unavailable;
    effect.state.itemValues = effect.values;
  }
}

/** Complete source admission. Unavailable effects are never partially granted. */
export function inspectItemSpec(item) {
  if (
    item?.category !== "Consume" ||
    !Number.isSafeInteger(item.id) ||
    !CONSUME_GROUPS.has(Math.floor(item.id / 10000))
  ) {
    throw new Error("Original consumable family is unavailable");
  }
  if (SPECIAL_SOURCES.has(item.id)) {
    throw new Error(
      "Original item priority/map-protection controller is unavailable",
    );
  }
  const card = Math.floor(item.id / 10000) === 238;
  admitInfo(item, card);
  const effect = readSpec(item, card);
  configureCard(effect);
  effect.pickup = isPickupItem(item);
  if (effect.values.onlyPickup === 1 && !effect.pickup) {
    throw new Error("Original onlyPickup source is inconsistent");
  }
  configureItemState(effect, item.id);
  if (!effect.state && !effect.recovery && !card && !effect.unavailable) {
    throw new Error("Original item has no applicable local effect");
  }
  return effect;
}

/** Inventory use shares admission, but auto-pickup/conditional effects belong to PickupEffects. */
export function prepareItemSpec(item) {
  try {
    const effect = inspectItemSpec(item);
    return effect.pickup ||
      effect.conditions ||
      effect.unavailable ||
      effect.values.party
      ? null
      : effect;
  } catch {
    return null;
  }
}

/** Cosmic StatEffect1484..1500: Alchemist scales flat recovery and duration, not hpR/mpR. */
export function applyAlchemist(effect, system) {
  if (!system) return effect;
  let info = null;
  for (const id of [4110000, 14110003]) {
    const rank = system.level(id);
    if (rank > 0) info = system.info(id, rank);
  }
  if (!info) return effect;
  for (const key of ["hp", "mp"]) {
    if (effect.values[key]) {
      effect.values[key] = Math.trunc((effect.values[key] * info.x) / 100);
    }
  }
  if (effect.state) {
    effect.values.time = Math.trunc((effect.values.time * info.y) / 100);
    configureTemporaryState(effect.state, effect.values, effect.values.time);
  }
  return effect;
}

function recoveredVital(current, maximum, flat = 0, percent = 0) {
  const proportional =
    Math.floor(maximum / 100) * percent +
    Math.floor(((maximum % 100) * percent) / 100);
  const missing = maximum - current;
  if (flat >= missing || proportional >= missing - flat) return maximum;
  return current + flat + proportional;
}

/** Called only on a detached commitProfile draft after revalidating the exact instance. */
export function applyItemVitals(profile, values) {
  profile.hp = recoveredVital(profile.hp, profile.maxHP, values.hp, values.hpR);
  profile.mp = recoveredVital(profile.mp, profile.maxMP, values.mp, values.mpR);
}
