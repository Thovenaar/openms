import { itemTooltip } from "./ui-tooltip.js";

/** All geometry is in the original unscaled CashShop800x600 reference plane. */
export function cashText(surface, text, rect, color = "#111") {
  const element = surface.text(text, rect.x, rect.y, rect.width);
  element.style.cssText += `font:11px Arial,sans-serif;line-height:14px;color:${color};white-space:pre-wrap;overflow-wrap:normal;`;
  if (rect.height) {
    element.style.cssText += `height:${rect.height}px;overflow:hidden;`;
  }
  return element;
}

export function cashInput(surface, rect, options = {}) {
  const input = document.createElement("input");
  input.setAttribute("aria-label", options.label ?? "Cash Shop input");
  input.value = options.value ?? "";
  input.maxLength = options.maxLength ?? 72;
  if (options.numeric) input.inputMode = "numeric";
  input.style.cssText = `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;box-sizing:border-box;border:0;padding:0 2px;background:white;color:black;font:12px/13px Arial,sans-serif;pointer-events:auto;user-select:text;`;
  surface.element.append(input);
  return input;
}

export function cashTemplate(panel, id) {
  return (
    panel.cashService.catalog.ui.items[id] ??
    panel.cashService.catalog.ui.cashShop.specialItems[id]
  );
}

export function cashTooltip(panel, item, surface) {
  const template = cashTemplate(panel, item.id ?? item.itemId);
  const tooltip = itemTooltip(panel.owner, template, template?.id ?? item.id);
  tooltip.lines = tooltip.lines.slice(1);
  appendCashTerms(tooltip.lines, item);
  appendPackageContents(panel, tooltip.lines, item.itemId);
  tooltip.source = { surface, path: template?.iconPath };
  return tooltip;
}

function appendCashTerms(lines, item) {
  if (item.price !== undefined) {
    lines.unshift({
      text: `${item.count} item(s) · ${item.price.toLocaleString()} ${item.category === 8 ? "Mesos" : "NX"}`,
      tone: "normal",
    });
  }
  if (item.period !== undefined) {
    lines.push({ text: `${item.period || 90} days`, tone: "normal" });
  }
  if (item.expiresAt !== undefined && item.expiresAt !== null) {
    lines.push({
      text: `Expires: ${new Date(item.expiresAt).toLocaleString()}`,
      tone: "normal",
    });
  }
  if (item.owner) lines.push({ text: item.owner, tone: "normal" });
}

function appendPackageContents(panel, lines, itemId) {
  const pack = panel.cashService.catalog.ui.cashShop.packages[itemId];
  if (pack) {
    for (const sn of pack.sns) {
      const offer = panel.cashService.catalog.ui.cashShop.commodities[sn];
      lines.push({
        text: `${cashTemplate(panel, offer?.itemId)?.name ?? "Original package item unavailable"} × ${offer?.count ?? 0}`,
        tone: "normal",
      });
    }
  }
}

export function closeCashDialog(panel) {
  if (!panel.cashDialog) return true;
  if (panel.cashService.pending) return false;
  panel.cashDialog.controller.abort();
  panel.cashDialog.layer.destroy();
  panel.cashDialog = null;
  panel.owner.hideTooltip();
  return true;
}

/** One owned native modal, never window.confirm/prompt and never a profile reservation. */
export function beginCashDialog(panel, name, size) {
  if (!closeCashDialog(panel) || panel.disposed || panel.cashService.pending) {
    return null;
  }
  const layer = panel.layer(name, { isolated: true });
  layer.element.style.pointerEvents = "auto";
  layer.element.style.zIndex = "40";
  layer.hit(
    "Cash Shop dialog backdrop",
    { x: 0, y: 0, width: 800, height: 600 },
    {
      pointerdown: (event) => {
        event.preventDefault();
        event.stopPropagation();
      },
    },
  );
  const body = layer.layer(name);
  body.width = size[0];
  body.height = size[1];
  body.element.style.width = `${size[0]}px`;
  body.element.style.height = `${size[1]}px`;
  body.element.style.pointerEvents = "auto";
  body.position(
    Math.floor((800 - size[0]) / 2),
    Math.floor((600 - size[1]) / 2),
  );
  const dialog = {
    layer,
    body,
    controller: new AbortController(),
    submit: null,
  };
  panel.cashDialog = dialog;
  body.element.setAttribute("role", "dialog");
  body.element.setAttribute("aria-modal", "true");
  body.element.tabIndex = -1;
  body.element.focus({ preventScroll: true });
  panel.owner.hideTooltip();
  return dialog;
}

/** GameUI routes this before its global edit-control capture. */
export function cashDialogKey(panel, event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeCashDialog(panel);
    return true;
  }
  if (event.key === "Enter" && !event.target.matches("button,textarea")) {
    event.preventDefault();
    panel.cashDialog?.submit?.();
    return true;
  }
  if (event.key === "Tab") {
    const controls = [
      ...panel.cashDialog.body.element.querySelectorAll(
        "button:not(:disabled),input:not(:disabled),textarea,select",
      ),
    ];
    if (!controls.length || controls.length > 128) return false;
    const current = controls.indexOf(document.activeElement);
    controls[
      (current + (event.shiftKey ? controls.length - 1 : 1)) % controls.length
    ].focus();
    event.preventDefault();
    return true;
  }
  return false;
}

export function cashMessage(panel, text) {
  const dialog = beginCashDialog(panel, "Cash Shop notice", [330, 153]);
  if (!dialog) return;
  dialog.body.image("CSWebMsg/backgrnd", 0, 0);
  cashText(dialog.body, text, { x: 18, y: 20, width: 294, height: 91 });
  dialog.submit = () => closeCashDialog(panel);
  dialog.body.button("BtOK2", 145, 123, { label: "OK", action: dialog.submit });
}

/** Authority outcomes are never inferred from a click; rejected promises are visibly reported. */
export async function cashOutcome(panel, promise) {
  try {
    const result = await promise;
    if (!result.ok && !panel.disposed) cashMessage(panel, result.reason);
    return result;
  } catch (error) {
    if (!panel.disposed) cashMessage(panel, error.message);
    return {
      ok: false,
      code: error.code ?? "cash-error",
      reason: error.message,
    };
  }
}
