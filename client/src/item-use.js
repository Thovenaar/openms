const USE_INTERVAL_MS = 200; // 004efd25, call004f0400 -> 00485bf7(200, 0).
const MAX_METADATA_FIELDS = 256;
const RECOVERY_FIELDS = new Set(["hp", "mp", "hpR", "mpR"]);
const RECOVERY_GROUPS = new Set([200, 201, 202, 205, 221, 236, 238, 245]);
// Presentation/economy metadata does not impose a use effect or character restriction.
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
]);

function supportedInfo(info) {
  if (!info || typeof info !== "object" || Array.isArray(info)) return false;
  const fields = Object.keys(info);
  if (fields.length > MAX_METADATA_FIELDS) return false;
  for (const field of fields) {
    if (PRESENTATION_FIELDS.has(field)) continue;
    if (field === "cash" && info[field] === 0) continue;
    return false;
  }
  return true;
}

/** Unknown nested effects/restrictions remain in the catalog and fail closed here. */
function recoverySpec(item) {
  if (item?.category !== "Consume" || !supportedInfo(item.info)) return null;
  if (!RECOVERY_GROUPS.has(Math.floor(item.id / 10000))) return null;
  if (!item.properties || Object.keys(item.properties).length !== 0) {
    return null;
  }
  return recoveryAmounts(item.spec);
}

function recoveryAmounts(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  const fields = Object.keys(spec);
  if (fields.length === 0 || fields.length > RECOVERY_FIELDS.size) return null;
  let positive = false;
  for (const field of fields) {
    if (!RECOVERY_FIELDS.has(field)) return null;
    const amount = spec[field];
    if (!validRecoveryAmount(field, amount)) return null;
    if (amount > 0) positive = true;
  }
  return positive ? spec : null;
}

function validRecoveryAmount(field, amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) return false;
  return !field.endsWith("R") || amount <= 100;
}

function recoveredVital(current, maximum, flat = 0, percent = 0) {
  // Integer quotient/remainder avoids both overflow and percentage rounding at large maxima.
  const proportional =
    Math.floor(maximum / 100) * percent +
    Math.floor(((maximum % 100) * percent) / 100);
  const missing = maximum - current;
  if (flat >= missing || proportional >= missing - flat) return maximum;
  return current + flat + proportional;
}

/**
 * 004efd25 -> 00a092fb: inclusive 200ms/dead admission, no full-HP gate.
 * 00a10579 -> 005daf30 checks authored minimum level and allowed maps.
 * Unimplemented item requirements fail closed above. Healing/decrement and completion
 * are local authority, not simulated server acceptance or a fabricated pending packet.
 */
export class ItemUse {
  constructor(store, catalog, hooks) {
    this.store = store;
    this.catalog = catalog;
    this.hooks = hooks;
    this.lastUse = -Infinity;
    this.onSaveFailure = this._saveFailure.bind(this);
  }

  _saveFailure(error) {
    this.hooks.report(`Local item use remains unsaved: ${error.message}`);
  }

  use(id) {
    const profile = this.store.profile;
    // Local death/modal gates have real runtime owners; unnamed native state fields are not guessed.
    if (this.hooks.isBlocked() || !profile || profile.hp === 0) return false;
    const now = this.hooks.now();
    if (!Number.isFinite(now) || now - this.lastUse < USE_INTERVAL_MS) {
      return false;
    }
    if (!Number.isSafeInteger(id) || Math.floor(id / 1000000) !== 2) {
      return false;
    }
    const index = profile.inventory.findIndex((entry) => entry.id === id);
    if (index < 0 || profile.inventory[index].count < 1) return false;
    const spec = recoverySpec(this.catalog.ui.items[id]);
    if (!spec) {
      this.hooks.report(
        "This item's original effects or restrictions are not supported locally.",
      );
      return false;
    }
    profile.hp = recoveredVital(profile.hp, profile.maxHP, spec.hp, spec.hpR);
    profile.mp = recoveredVital(profile.mp, profile.maxMP, spec.mp, spec.mpR);
    const entry = profile.inventory[index];
    entry.count--;
    if (entry.count === 0) profile.inventory.splice(index, 1);
    this.lastUse = now;
    this.store.markDirty();
    this.store.flush().catch(this.onSaveFailure);
    this.hooks.report(
      "Recovery item consumed by local offline authority; no server request was sent.",
    );
    return true;
  }
}
