import { profileError } from "../profile/profile-validation.js";
import {
  consumeItem,
  createItemUid,
  grantItem,
  inventoryType,
  isRechargeable,
  itemCount,
} from "../items/inventory-model.js";
import {
  admitItem,
  originalItem,
  gatherInventory,
} from "../items/inventory-action-rules.js";

export function storageRequire(condition, message, code = "storage-operation") {
  if (!condition) throw profileError(code, message);
}

export function storageInteger(value, minimum, maximum) {
  storageRequire(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    "Invalid storage quantity.",
  );
}

export function storageSelection(profile, account, request, templates) {
  const entries =
    request.kind === "deposit" ? profile.inventory : account.items;
  const item = entries.find((entry) => entry.uid === request.uid);
  storageRequire(item, "The selected item is no longer there.", "stale-item");
  admitItem(profile, item);
  const template = originalItem(templates, item.id);
  storageRequire(
    inventoryType(item.id) !== 5 && !template.info.cash,
    "Cash items cannot be stored here.",
  );
  storageRequire(
    !(item.flags & 1),
    "Sealed items cannot be stored or retrieved.",
  );
  return { item, template };
}

function transferredItem(item, count) {
  const moved = {
    ...item,
    count,
    uid: count === item.count ? item.uid : createItemUid(),
  };
  // Cosmic KarmaManipulator38-46 consumes the relevant transfer flag in both directions.
  const karma = inventoryType(item.id) === 1 ? 0x10 : 0x02;
  if (moved.flags & karma) moved.flags = (moved.flags ^ karma) | 0x08;
  return moved;
}

function deposit(profile, account, request, item) {
  storageRequire(
    ![1112803, 1112806, 1112807, 1112809].includes(item.id) &&
      !(item.id >= 4031357 && item.id <= 4031364),
    "Wedding items cannot be stored.",
  );
  storageRequire(
    account.items.length < account.slots,
    "The storage is full.",
    "storage-full",
  );
  const count = isRechargeable(item.id) ? item.count : request.count;
  storageInteger(count, isRechargeable(item.id) ? 0 : 1, item.count);
  const moved = transferredItem(item, count);
  consumeItem(profile, item.uid, count);
  moved.slot = account.items.length + 1;
  account.items.push(moved);
}

function withdraw(profile, account, item, template) {
  storageRequire(
    !template.info.only || itemCount(profile, item.id) === 0,
    "Item could not be retrieved because there was an item that could only be acquired once.",
  );
  const moved = transferredItem(item, item.count);
  grantItem(profile, template, moved.count, moved);
  account.items.splice(account.items.indexOf(item), 1);
  for (let index = 0; index < account.items.length; index++) {
    account.items[index].slot = index + 1;
  }
}

function transferMeso(profile, account, request) {
  storageInteger(request.count, 1, 2147483647);
  const amount =
    request.kind === "deposit-meso" ? request.count : -request.count;
  storageRequire(
    profile.meso - amount >= 0 && account.meso + amount >= 0,
    "You do not have enough mesos.",
    "insufficient-mesos",
  );
  storageRequire(
    profile.meso - amount <= 2147483647 && account.meso + amount <= 2147483647,
    "You cannot hold any more mesos.",
  );
  profile.meso -= amount;
  account.meso += amount;
}

function arrangeStorage(profile, account, items) {
  const projection = {
    ...profile,
    inventory: account.items,
    equipment: [],
    inventorySlots: [48, 48, 48, 48, 48],
  };
  for (let type = 1; type <= 4; type++) {
    gatherInventory(projection, items, { type });
  }
  account.items.sort(
    (left, right) => left.id - right.id || left.slot - right.slot,
  );
  for (let index = 0; index < account.items.length; index++) {
    account.items[index].slot = index + 1;
  }
}

/** Cosmic StorageProcessor66-230; failed capacity/funds checks never charge the fee. */
export function applyStorageTransfer(profile, account, request, context) {
  if (request.kind === "deposit-meso" || request.kind === "withdraw-meso") {
    transferMeso(profile, account, request);
    return;
  }
  if (request.kind === "sort") {
    arrangeStorage(profile, account, context.items);
    return;
  }
  storageRequire(
    request.kind === "deposit" || request.kind === "withdraw",
    "Unsupported storage operation.",
  );
  const { item, template } = storageSelection(
    profile,
    account,
    request,
    context.items,
  );
  if (request.instance) {
    for (const key of [
      "uid",
      "id",
      "slot",
      "count",
      "owner",
      "flags",
      "expiresAt",
    ]) {
      storageRequire(
        item[key] === request.instance[key],
        "The selected item changed while the storage prompt was open.",
        "stale-item",
      );
    }
  }
  const fee =
    request.kind === "deposit" ? context.fees.putFee : context.fees.getFee;
  storageInteger(fee, 0, 2147483647);
  storageRequire(
    profile.meso >= fee,
    "You do not have enough mesos.",
    "insufficient-mesos",
  );
  if (request.kind === "deposit") deposit(profile, account, request, item);
  else withdraw(profile, account, item, template);
  profile.meso -= fee;
}
