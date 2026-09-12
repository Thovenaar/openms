import { itemIcon, replaceIcons } from "./ui-icons.js";

/** Native007f5c9b:178x206, cancel65,180, close158,8, white-scroll checkbox10,153. */
export function layoutEnhancement(panel) {
  panel.image("EnchantSkill/backgrnd", 0, 0);
  panel.enhancementSay = panel.image("EnchantSkill/say0", 46, 26);
  panel.image("EnchantSkill/say2", 30, 150);
  panel.enhancementUid = null;
  panel.enhancementPending = false;
  panel.enhancementWhite = false;
  panel.enhancementCancel = panel.button("BtCancel2", 65, 180, {
    label: "Close Legendary Spirit",
    action: () => closeEnhancement(panel),
  });
  panel.button("BtClose", 158, 8, {
    label: "Close Legendary Spirit",
    action: () => closeEnhancement(panel),
  });
  panel.enhancementCheck = panel.image("CheckBox/0", 10, 153);
  panel.hit(
    "Use White Scroll",
    { x: 10, y: 150, width: 140, height: 17 },
    {
      click: () => toggleWhiteScroll(panel),
    },
  );
  panel.hit(
    "Equipment and scroll target",
    { x: 74, y: 94, width: 32, height: 32 },
    {},
  );
  panel.enhancementStatus = panel.text("", 8, 55, 162);
  panel.enhancementStatus.setAttribute("role", "status");
  panel.enhancementStatus.style.cssText +=
    "font:11px Arial;color:#900;white-space:pre-wrap;";
  panel.localRefresh = () => refreshEnhancement(panel);
}

function closeEnhancement(panel) {
  if (!panel.enhancementPending) panel.owner.close(panel.name);
}

function toggleWhiteScroll(panel) {
  if (panel.enhancementPending) return;
  panel.enhancementWhite = !panel.enhancementWhite;
  panel.enhancementCheck.container.visible = !panel.enhancementWhite;
  if (!panel.enhancementChecked) {
    panel.enhancementChecked = panel.image("CheckBox/1", 10, 153);
  }
  panel.enhancementChecked.container.visible = panel.enhancementWhite;
}

function composeEquipment(layer, entry) {
  itemIcon(layer, entry, { x: 74, y: 94, width: 32, height: 32 });
}

export function refreshEnhancement(panel) {
  if (!panel?.enhancementUid || panel.disposed) return;
  const profile = panel.owner.store.profile;
  const item =
    profile.inventory.find((entry) => entry.uid === panel.enhancementUid) ??
    profile.equipment.find((entry) => entry.uid === panel.enhancementUid);
  if (item) return;
  panel.enhancementUid = null;
  panel.iconLayer?.destroy();
  panel.iconLayer = null;
}

/** Same item carry owner, same durable item transaction; placing equipment never consumes it. */
export async function dropEnhancementItem(panel, item) {
  if (panel.enhancementPending) {
    return { ok: false, reason: "Enhancement is pending" };
  }
  if (Math.floor(item.id / 1000000) === 1) {
    panel.enhancementUid = item.uid;
    panel.enhancementStatus.textContent = "";
    await replaceIcons(
      panel,
      [{ ...item, template: panel.owner.index.items[item.id] }],
      composeEquipment,
    );
    return { ok: true };
  }
  if (!panel.enhancementUid) {
    return { ok: false, reason: "Place equipment in Legendary Spirit first" };
  }
  const utility = panel.owner.hooks.skillUtilities();
  panel.enhancementPending = true;
  try {
    const result = await utility.enhancement.enhance({
      equipUid: panel.enhancementUid,
      scrollUid: item.uid,
      whiteScroll: panel.enhancementWhite,
    });
    if (!panel.disposed) {
      panel.enhancementStatus.textContent = result.ok
        ? enhancementResult(result.outcome)
        : result.reason;
      refreshEnhancement(panel);
    }
    return result;
  } finally {
    panel.enhancementPending = false;
  }
}

export function enhancementResult(outcome) {
  if (outcome === "success") {
    return "The scroll's power was transferred to the item.";
  }
  if (outcome === "curse") return "The item was destroyed by the scroll.";
  return "The scroll had no effect.";
}
