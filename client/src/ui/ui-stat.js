const DAMAGE_FORMAT = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const AP_TARGETS = ["hp", "mp", "str", "dex", "int", "luk"];
const AP_ROWS = [117, 135, 247, 265, 283, 301];
// 008c2870 renders the actual calculated combat values over Stat/backgrnd2.
const DETAIL_ROWS = [
  ["damage", 8],
  ["pdd", 26],
  ["mad", 44],
  ["mdd", 62],
  ["acc", 80],
  ["eva", 98],
  ["hands", 116],
  ["speed", 134],
  ["jump", 152],
];

export function layoutStatControls(panel) {
  for (let i = 0; i < AP_TARGETS.length; i++) {
    const target = AP_TARGETS[i];
    panel.statControls.push(
      panel.button("Stat/BtApUp", 153, AP_ROWS[i], {
        label: `Increase ${target.toUpperCase()}`,
        action: () => spendAp(panel, target),
        disabled: true,
      }),
    );
  }
  //008c4c7f creates BtDetail at124,324 for every job/level;008c5531 places the child.
  panel.detailControl = panel.button("Stat/BtDetail", 124, 324, {
    label: "Detailed statistics",
    action: () => toggleStatDetail(panel),
  });
}

export function updateApControls(panel, profile) {
  panel.detailControl.setVisible(Boolean(profile));
  for (let i = 0; i < AP_TARGETS.length; i++) {
    const result = panel.owner.hooks.apAdmission?.(AP_TARGETS[i]);
    panel.statControls[i].setDisabled(
      !profile || Boolean(panel.apPending) || result?.ok !== true,
    );
  }
}

async function spendAp(panel, target) {
  const owner = panel.owner;
  const store = owner.store;
  if (panel.apPending || owner.hooks.apAdmission?.(target)?.ok !== true) return;
  panel.apPending = true;
  updateApControls(panel, store.profile);
  try {
    await commitApSpend(panel, target, store);
  } catch (error) {
    if (ownsApRequest(panel, store)) owner.report(error);
  } finally {
    panel.apPending = false;
    if (!panel.disposed) owner.refreshProfilePanel(panel);
  }
}

function ownsApRequest(panel, store) {
  return !panel.disposed && panel.owner.store === store;
}

function needsApConfirmation(target, profile) {
  return (target === "hp" || target === "mp") && profile.level > 19;
}

async function commitApSpend(panel, target, store) {
  const owner = panel.owner;
  let confirmed = false;
  if (needsApConfirmation(target, store.profile)) {
    if (typeof owner.hooks.confirmAp !== "function") {
      throw new Error("Native HP/MP confirmation is unavailable");
    }
    confirmed = await owner.hooks.confirmAp(target);
    if (!confirmed) return;
  }
  if (!ownsApRequest(panel, store)) return;
  const result = await owner.hooks.spendAp(target, { confirmed });
  if (!result.ok && ownsApRequest(panel, store)) {
    owner.status(result.reason || result.code);
  }
}

function toggleStatDetail(panel) {
  if (panel.statDetail) {
    panel.statDetail.destroy();
    panel.statDetail = null;
    panel.renderArtwork();
    return;
  }
  const detail = panel.layer("Stat Detail");
  panel.statDetail = detail;
  detail.width = 177;
  detail.height = 203;
  detail.element.style.width = "177px";
  detail.element.style.height = "203px";
  detail.position(170, 144);
  detail.image("Stat/backgrnd2", 0, 0);
  detail.button("BtHide", 155, 182, {
    label: "Close detailed statistics",
    action: () => toggleStatDetail(panel),
  });
  detail.statValues = new Map();
  for (const [key, y] of DETAIL_ROWS) {
    const value = detail.text("", 77, y, 91);
    value.style.cssText += "white-space:nowrap;line-height:13px;";
    detail.statValues.set(key, value);
  }
  updateStatDetail(panel);
  panel.owner.positionWindow(panel, panel.x, panel.y);
  panel.renderArtwork();
}

export function updateStatDetail(panel) {
  if (!panel.statDetail) return;
  const stats = panel.owner.hooks.characterStats?.();
  const display = stats ? { ...stats } : null;
  if (display) statDamage(display);
  for (const [key, element] of panel.statDetail.statValues) {
    const value = statDetailValue(display, key);
    element.textContent =
      value === undefined || value === null ? "—" : String(value);
    const exact =
      key === "damage" && display
        ? `${display.damageMin} ~ ${display.damageMax}`
        : value;
    element.setAttribute("aria-label", `${key}: ${exact ?? "unavailable"}`);
    element.setAttribute("title", String(exact ?? "unavailable"));
  }
}

function statDetailValue(stats, key) {
  let value = stats?.[key];
  if (
    key === "damage" &&
    Number.isFinite(stats?.damageMin) &&
    Number.isFinite(stats?.damageMax)
  ) {
    value = `${DAMAGE_FORMAT.format(stats.damageMin)} ~ ${DAMAGE_FORMAT.format(stats.damageMax)}`;
  }
  if ((key === "speed" || key === "jump") && Number.isFinite(value)) {
    value = `${value}%`;
  }
  return value;
}
import { statDamage } from "./ui-stat-damage.js";
