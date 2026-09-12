// Browser preferences, not original Windows registry or character-save semantics.
const STORAGE_KEY = "maple.ui.window-positions.v1";
const MAX_BYTES = 16384;
const MAX_COORDINATE = 32768;

/** Read only supported window names and finite logical-pixel pairs. Corruption is explicit. */
export function loadWindowPositions(names) {
  const positions = new Map();
  const text = localStorage.getItem(STORAGE_KEY);
  if (text === null) return positions;
  const entries = parseWindowPositions(text, names.size);
  for (const entry of entries) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 3 ||
      !names.has(entry[0]) ||
      positions.has(entry[0]) ||
      !validCoordinate(entry[1]) ||
      !validCoordinate(entry[2])
    ) {
      throw new Error("Invalid saved UI window position");
    }
    positions.set(entry[0], { x: entry[1], y: entry[2] });
  }
  return positions;
}

/** Bound and validate the persisted envelope before iterating coordinate records. */
function parseWindowPositions(text, maximum) {
  if (text.length > MAX_BYTES) {
    throw new Error("Saved UI positions exceed the preference limit");
  }
  const saved = JSON.parse(text);
  if (
    !saved ||
    saved.version !== 1 ||
    !Array.isArray(saved.positions) ||
    saved.positions.length > maximum
  ) {
    throw new Error("Invalid saved UI window positions");
  }
  return saved.positions;
}

function validCoordinate(value) {
  return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

/** Called at drag/close/resize boundaries, never from pointermove or a frame loop. */
export function saveWindowPositions(positions, names) {
  if (positions.size > names.size) {
    throw new Error("UI window position limit exceeded");
  }
  const entries = [];
  for (const [name, position] of positions) {
    if (
      !names.has(name) ||
      !validCoordinate(position.x) ||
      !validCoordinate(position.y)
    ) {
      throw new Error("Cannot save invalid UI window position");
    }
    entries.push([name, position.x, position.y]);
  }
  const text = JSON.stringify({ version: 1, positions: entries });
  if (text.length > MAX_BYTES) {
    throw new Error("UI window positions exceed the preference limit");
  }
  localStorage.setItem(STORAGE_KEY, text);
}

const TAB_STORAGE_KEY = "maple.ui.window-tabs.v1";
// Finite native controller inventory, including nested tab strips and the HUD selector.
const TAB_OWNERS = new Set([
  "Item",
  "Skill",
  "Quest",
  "UserList",
  "PartySearch",
  "Title",
  "Shop.buy",
  "Shop.sell",
  "Trunk",
  "MonsterBook.category",
  "MonsterBook.detail",
  "CashShop.category",
  "CashShop.subcategory",
  "CashShop.inventory",
  "CashShop.preview",
  "Chat.channel",
]);

function validTabEntry(key, value) {
  return TAB_OWNERS.has(key) && Number.isSafeInteger(value) && value >= -1;
}

/** Preserve the position v1 envelope; tab choices have their own bounded browser preference. */
export function loadWindowTabs() {
  const text = localStorage.getItem(TAB_STORAGE_KEY);
  if (text === null) return new Map();
  if (text.length > MAX_BYTES) {
    throw new Error("Saved UI tabs exceed the preference limit");
  }
  const saved = JSON.parse(text);
  if (
    saved?.version !== 1 ||
    !Array.isArray(saved.tabs) ||
    saved.tabs.length > TAB_OWNERS.size
  ) {
    throw new Error("Invalid saved UI tabs");
  }
  const tabs = new Map();
  for (const entry of saved.tabs) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !validTabEntry(entry[0], entry[1]) ||
      tabs.has(entry[0])
    ) {
      throw new Error("Invalid saved UI tab");
    }
    tabs.set(entry[0], entry[1]);
  }
  return tabs;
}

export function saveWindowTabs(tabs) {
  if (tabs.size > TAB_OWNERS.size) {
    throw new Error("UI tab preference limit exceeded");
  }
  for (const [key, value] of tabs) {
    if (!validTabEntry(key, value)) {
      throw new Error("Cannot save invalid UI tab");
    }
  }
  const text = JSON.stringify({ version: 1, tabs: Array.from(tabs) });
  if (text.length > MAX_BYTES) {
    throw new Error("UI tabs exceed the preference limit");
  }
  localStorage.setItem(TAB_STORAGE_KEY, text);
}
