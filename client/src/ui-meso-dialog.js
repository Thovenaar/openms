// 0081d996: numeric dialog default/min10, maxmin(balance,50000); original string5280.
export const MESO_DROP_MIN = 10;
export const MESO_DROP_MAX = 50000;
const PROMPT =
  "How many will you drop? (A portion of the amount may be lost if picked up by another user.)";

/** No rounding, exponent notation or partial parses at the user-input boundary. */
export function parseMesoAmount(text, balance) {
  if (typeof text !== "string" || !/^\d{1,10}$/.test(text)) {
    return { ok: false, reason: "Enter a whole number of Mesos." };
  }
  const amount = Number(text);
  const maximum = Math.min(MESO_DROP_MAX, balance);
  if (!Number.isSafeInteger(balance) || balance < MESO_DROP_MIN) {
    return { ok: false, reason: "You do not have enough Mesos to drop." };
  }
  if (amount < MESO_DROP_MIN || amount > maximum) {
    return {
      ok: false,
      reason: `Enter an amount from ${MESO_DROP_MIN} to ${maximum.toLocaleString("en-US")}.`,
    };
  }
  return { ok: true, amount };
}

/** 009a4f1d compact branch uses Notice3/t,c + Notice4/s;009a8716 owns input and buttons. */
export function layoutMesoDialog(panel) {
  panel.element.setAttribute("aria-label", "Drop Mesos");
  const prompt = panel.text(PROMPT, 20, 22, 226);
  prompt.style.cssText += "font:12px Arial,sans-serif;line-height:16px;";
  const textHeight = prompt.offsetHeight;
  panel.height = 99 + textHeight;
  panel.element.style.height = `${panel.height}px`;
  panel.image("Notice3/t", 0, 0);
  const middle = panel.image("Notice3/c", 0, 21);
  middle.container.scale.y = textHeight / 20;
  panel.image("Notice4/s", 0, 21 + textHeight);
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.pattern = "[0-9]*";
  input.maxLength = 10;
  input.value = String(MESO_DROP_MIN);
  input.setAttribute("aria-label", "Mesos to drop");
  input.style.cssText = `position:absolute;left:19px;top:${panel.height - 73}px;width:226px;height:15px;border:0;background:transparent;color:black;font:12px Arial,sans-serif;text-align:right;padding:0 2px;`;
  panel.element.append(input);
  panel.mesoInput = input;
  panel.mesoBalance = panel.text("", 20, panel.height - 53, 226);
  panel.mesoBalance.style.fontSize = "10px";
  panel.mesoError = panel.text("", 20, panel.height - 55, 226);
  panel.mesoError.style.cssText +=
    "font:10px Arial,sans-serif;line-height:12px;color:#b00000;max-height:24px;overflow:auto;pointer-events:auto;";
  panel.mesoError.setAttribute("role", "status");
  panel.mesoConfirm = panel.button("BtOK2", 158, panel.height - 30, {
    label: "Drop Mesos",
    action: () => submitMesoDrop(panel),
  });
  panel.mesoCancel = panel.button("BtCancel2", 208, panel.height - 30, {
    label: "Cancel mesos drop",
    action: () => panel.owner.close(panel.name),
  });
  panel.listen(input, "input", () => {
    panel.mesoError.textContent = "";
    refreshMesoDialog(panel);
  });
  refreshMesoDialog(panel);
}

export function refreshMesoDialog(panel) {
  if (!panel?.mesoInput || panel.disposed) return;
  const profile = panel.owner.store?.profile;
  const balance = profile?.meso;
  panel.mesoBalance.textContent = `Balance: ${Number.isSafeInteger(balance) ? balance.toLocaleString("en-US") : "Unavailable"} · Max: 50,000`;
  panel.mesoBalance.hidden = Boolean(panel.mesoError.textContent);
  const disabled =
    panel.mesoPending ||
    !profile ||
    profile.hp <= 0 ||
    panel.owner.store.profileTransactionPending;
  panel.mesoConfirm.setDisabled(Boolean(disabled));
  panel.mesoInput.disabled = Boolean(panel.mesoPending);
  // In-flight debit cannot be cancelled by merely hiding its confirmation.
  panel.mesoCancel.setDisabled(Boolean(panel.mesoPending));
}

/** Apply authority results only to the profile and dialog that initiated the request. */
function applyMesoDropResult(panel, result, { owner, store, epoch }) {
  if (panel.disposed || !owner.ownsProfile(store, epoch)) return;
  if (!result || typeof result.ok !== "boolean") {
    throw new Error("Invalid mesos-drop result");
  }
  if (result.ok) {
    owner.close(panel.name, true);
    return;
  }
  panel.mesoError.textContent =
    result.reason || `Mesos drop rejected (${result.code || "unknown"}).`;
}

/** One async authority call; retain the amount/error until explicit success. UI never debits. */
export async function submitMesoDrop(panel) {
  if (panel.disposed || panel.mesoPending) return;
  const owner = panel.owner;
  const store = owner.store;
  const epoch = owner.epoch;
  const ownership = { owner, store, epoch };
  const parsed = parseMesoAmount(panel.mesoInput.value, store?.profile?.meso);
  if (!parsed.ok) {
    panel.mesoError.textContent = parsed.reason;
    refreshMesoDialog(panel);
    panel.mesoInput.focus();
    return;
  }
  if (typeof owner.hooks.onDropMesos !== "function") {
    panel.mesoError.textContent = "Mesos dropping is unavailable.";
    refreshMesoDialog(panel);
    return;
  }
  panel.mesoPending = true;
  panel.mesoError.textContent = "Dropping Mesos…";
  refreshMesoDialog(panel);
  try {
    const result = await owner.hooks.onDropMesos(parsed.amount);
    applyMesoDropResult(panel, result, ownership);
  } catch (error) {
    if (!panel.disposed && owner.ownsProfile(store, epoch)) {
      panel.mesoError.textContent = `Mesos drop failed: ${error.message}`;
    }
    owner.report(error);
  } finally {
    panel.mesoPending = false;
    if (!panel.disposed) {
      refreshMesoDialog(panel);
      panel.mesoInput.focus();
    }
  }
}
