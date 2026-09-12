// 0081d996: numeric dialog default/min10, maxmin(balance,50000); original string5280.
export const MESO_DROP_MIN = 10;
export const MESO_DROP_MAX = 50000;
const PROMPT = "How many will you drop?";

/** 009ab50a: ASCII digits, inclusive min/max, warning009929dd then refocus009e3264. */
export function parseMesoAmount(text, balance) {
  if (typeof text !== "string" || !/^\d{0,10}$/.test(text)) {
    return { ok: false, reason: "Only numbers are allowed." };
  }
  const amount = Number(text);
  const maximum = Math.min(MESO_DROP_MAX, balance);
  if (!Number.isSafeInteger(balance) || balance < 0) {
    return { ok: false, reason: "Mesos balance is unavailable." };
  }
  // Original strings817/818/819 retain distinct malformed, minimum and maximum warnings.
  if (amount < MESO_DROP_MIN) {
    return {
      ok: false,
      reason: `You may only enter a number \r\nequal to or higher than ${MESO_DROP_MIN}.`,
    };
  }
  if (amount > maximum) {
    return {
      ok: false,
      reason: `You may only enter a number \r\nequal to or lower than ${maximum}.`,
    };
  }
  return { ok: true, amount };
}

/** Compact CUtilDlgEx:009a3d07 width225,009a2d01/009a2421 line step18. */
export function layoutCompactInput(panel, text) {
  const prompt = panel.text(text, 20, 22, 225);
  prompt.style.cssText +=
    "font:12px/18px Arial,sans-serif;color:#000;white-space:pre-wrap;overflow-wrap:break-word;";
  const measured = prompt.scrollHeight;
  // Browser containment only: native numeric text has no maximum body height.
  const available = panel.owner.viewportHeight / panel.owner.scale - 99;
  const limit = Number.isFinite(available)
    ? Math.min(4096, Math.max(18, available))
    : 4096;
  const textHeight = Math.min(measured, limit);
  if (!Number.isFinite(textHeight) || textHeight < 0) {
    throw new Error("Numeric prompt must be measured in a visible UI surface");
  }
  prompt.style.maxHeight = `${textHeight}px`;
  prompt.style.overflow = "auto";
  prompt.style.pointerEvents = "auto";
  panel.width = 266;
  panel.height = 99 + textHeight;
  panel.element.style.width = `${panel.width}px`;
  panel.element.style.height = `${panel.height}px`;
  drawMesoChrome(panel, textHeight);
  return prompt;
}

/** 0081d996 selects compact mode;009a8716 owns the editor and button coordinates. */
export function layoutMesoDialog(panel) {
  panel.element.setAttribute("aria-label", "Drop Mesos");
  layoutCompactInput(panel, PROMPT);
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.pattern = "[0-9]*";
  input.maxLength = 10;
  input.value = String(MESO_DROP_MIN);
  input.setAttribute("aria-label", "Mesos to drop");
  input.style.cssText = `position:absolute;left:19px;top:${panel.height - 73}px;width:226px;height:15px;box-sizing:border-box;border:0;border-radius:0;background:transparent;color:black;font:12px/15px Arial,sans-serif;text-align:right;padding:0 2px;`;
  panel.element.append(input);
  panel.mesoInput = input;
  // The original has no balance/range label in the blue body. Keep the live
  // authority limits accessible without painting invented text over its chrome.
  panel.mesoBalance = panel.text("", 20, panel.height - 54, 226);
  panel.mesoBalance.hidden = true;
  panel.mesoConfirm = panel.button("BtOK2", 158, panel.height - 30, {
    label: "Drop Mesos",
    action: () => submitMesoDrop(panel),
  });
  panel.mesoCancel = panel.button("BtCancel2", 208, panel.height - 30, {
    label: "Cancel mesos drop",
    action: () => panel.owner.close(panel.name),
  });
  panel.listen(input, "input", () => refreshMesoDialog(panel));
  panel.cleanups.push(() => panel.mesoWarning?.abort());
  refreshMesoDialog(panel);
}

/** Tile authored pixels rather than stretching the original border/gradient rows. */
function drawMesoChrome(panel, textHeight) {
  panel.image("Notice3/t", 0, 0);
  const middle = panel.assets["Notice3/c"];
  if (middle?.width !== 266 || middle.height !== 20) {
    throw new Error("Original compact numeric dialog chrome is unavailable");
  }
  const tiles = panel.layer("Compact numeric dialog middle");
  tiles.root.rasterClip = { x: 0, y: 21, width: 266, height: textHeight };
  const count = Math.ceil(textHeight / middle.height);
  if (count > 205) {
    throw new Error("Numeric prompt exceeds browser chrome tile bound");
  }
  for (let index = 0; index < count; index++) {
    tiles.image("Notice3/c", 0, 21 + index * middle.height);
  }
  panel.image("Notice4/s", 0, 21 + textHeight);
}

function mesoBalanceText(balance, maximum) {
  if (!Number.isSafeInteger(balance)) return "Balance unavailable";
  const amount =
    maximum >= MESO_DROP_MIN
      ? `Amount: ${MESO_DROP_MIN} – ${maximum.toLocaleString("en-US")}`
      : "Not enough Mesos to drop.";
  return `Balance: ${balance.toLocaleString("en-US")}\n${amount}`;
}

export function refreshMesoDialog(panel) {
  if (!panel?.mesoInput || panel.disposed) return;
  const profile = panel.owner.store?.profile;
  const balance = profile?.meso;
  const available = Number.isSafeInteger(balance);
  const maximum = available ? Math.min(MESO_DROP_MAX, balance) : 0;
  panel.mesoBalance.textContent = mesoBalanceText(balance, maximum);
  panel.mesoInput.setAttribute(
    "aria-description",
    panel.mesoBalance.textContent,
  );
  panel.mesoBalance.hidden = true;
  const pending = Boolean(panel.mesoPending || panel.mesoWarning);
  panel.mesoConfirm.setDisabled(pending || mesoProfileDisabled(panel, profile));
  panel.mesoInput.disabled = pending;
  // In-flight debit cannot be cancelled by merely hiding its confirmation.
  panel.mesoCancel.setDisabled(pending);
}

function mesoProfileDisabled(panel, profile) {
  return Boolean(
    !profile || profile.hp <= 0 || panel.owner.store.profileTransactionPending,
  );
}

/** Apply authority results only to the profile and dialog that initiated the request. */
function applyMesoDropResult(panel, result, { owner, store, epoch }) {
  if (panel.disposed || !owner.ownsProfile(store, epoch)) return null;
  if (!result || typeof result.ok !== "boolean") {
    throw new Error("Invalid mesos-drop result");
  }
  if (result.ok) {
    owner.close(panel.name, true);
    return null;
  }
  return result.reason || `Mesos drop rejected (${result.code || "unknown"}).`;
}

/** Reuse the shop's native Notice3 modal; keep the quantity editor and its draft underneath. */
async function showMesoWarning(panel, text, { owner, store, epoch }) {
  if (panel.disposed || !owner.ownsProfile(store, epoch)) return;
  const controller = new AbortController();
  panel.mesoWarning = controller;
  refreshMesoDialog(panel);
  try {
    await owner.prompt({
      kind: "notice",
      text,
      owner: panel,
      signal: controller.signal,
    });
  } catch (error) {
    owner.report(error);
  } finally {
    if (panel.mesoWarning === controller) panel.mesoWarning = null;
    if (!panel.disposed && owner.ownsProfile(store, epoch)) {
      refreshMesoDialog(panel);
      if (owner.modal() === panel) panel.mesoInput.focus();
    }
  }
}

/** One async authority call; invalid input never reaches debit and every failure retains the draft. */
export async function submitMesoDrop(panel) {
  if (panel.disposed || panel.mesoPending || panel.mesoWarning) return;
  const owner = panel.owner;
  const store = owner.store;
  const epoch = owner.epoch;
  const ownership = { owner, store, epoch };
  const parsed = parseMesoAmount(panel.mesoInput.value, store?.profile?.meso);
  if (!parsed.ok) {
    await showMesoWarning(panel, parsed.reason, ownership);
    return;
  }
  if (typeof owner.hooks.onDropMesos !== "function") {
    await showMesoWarning(panel, "Mesos dropping is unavailable.", ownership);
    return;
  }
  panel.mesoPending = true;
  refreshMesoDialog(panel);
  let warning = null;
  try {
    const result = await owner.hooks.onDropMesos(parsed.amount);
    warning = applyMesoDropResult(panel, result, ownership);
  } catch (error) {
    warning = `Mesos drop failed: ${error.message}`;
    owner.report(error);
  } finally {
    panel.mesoPending = false;
    if (!panel.disposed) refreshMesoDialog(panel);
  }
  if (warning) await showMesoWarning(panel, warning, ownership);
}
