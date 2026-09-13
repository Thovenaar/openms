import { replaceIcons } from "./ui-icons.js";
import { NativeScrollbar } from "./ui-scrollbar.js";
import {
  beginCashDialog,
  closeCashDialog,
  cashText,
  cashInput,
  cashTemplate,
  cashMessage,
  cashOutcome,
  cashTooltip,
} from "./ui-cash-modal.js";

const PAYMENT_ROWS = [
  ["points", "Maple Points"],
  ["prepaid", "NX Prepaid"],
  ["credit", "NX Credit"],
];

function paymentControls(panel, dialog, y) {
  const payment = { selected: panel.cashCurrency };
  const choices = [];
  const refresh = () => {
    for (const choice of choices) {
      const checked = payment.selected === choice.value;
      choice.off.container.visible = !checked;
      choice.on.container.visible = checked;
      choice.hit.setAttribute("aria-checked", String(checked));
    }
  };
  for (let index = 0; index < PAYMENT_ROWS.length; index++) {
    const [value, label] = PAYMENT_ROWS[index];
    const top = y + index * 14;
    const off = dialog.body.image("CheckBox/0", 23, top);
    const on = dialog.body.image("CheckBox/1", 23, top);
    const hit = dialog.body.hit(
      label,
      { x: 23, y: top, width: 240, height: 13 },
      {
        click: () => {
          payment.selected = value;
          refresh();
        },
      },
    );
    hit.setAttribute("role", "radio");
    choices.push({ value, off, on, hit });
  }
  refresh();
  return () => payment.selected;
}

function purchaseArt(body, count) {
  body.image("CSNotice/0/0", 0, 0);
  for (let index = 0; index < count; index++) {
    body.image("CSNotice/0/1", 0, 21 + index * 40);
  }
  body.image("CSNotice/0/2", 0, 21 + count * 40);
  body.image("CSNotice/0/3", 0, 26 + count * 40);
  body.image("CSNotice/0/4", 0, 45 + count * 40);
}

function purchaseRows(panel, dialog, offers) {
  const records = offers.map((offer) => ({
    template: cashTemplate(panel, offer.itemId),
    offer,
  }));
  replaceIcons(dialog.body, records, (layer, record, index) => {
    const { template, offer } = record;
    if (template) layer.image(template.iconPath, 19, 23 + index * 40);
    cashText(
      layer,
      template?.name ?? "Original commodity name unavailable",
      { x: 61, y: 24 + index * 40, width: 210, height: 15 },
      "#fff",
    );
    cashText(
      layer,
      `${offer.count} item(s) · ${offer.price.toLocaleString()} NX`,
      { x: 61, y: 41 + index * 40, width: 210 },
      "#fff",
    );
  });
}

/** Original CSNotice0 composition; choosing or cancelling has no transaction side effects. */
export function cashPurchaseDialog(panel, sns) {
  const offers = sns.map(
    (sn) => panel.cashService.catalog.ui.cashShop.commodities[sn],
  );
  if (!offers.length || offers.some((offer) => !offer)) return;
  if (offers.length === 1 && offers[0].category === 8) {
    buyMesoCommodity(panel, offers[0]);
    return;
  }
  const rows = Math.min(offers.length, 8);
  const height = 149 + rows * 40;
  const dialog = beginCashDialog(panel, "Buy cash item", [286, height]);
  if (!dialog) return;
  purchaseArt(dialog.body, rows);
  purchaseRows(panel, dialog, offers.slice(0, rows));
  if (offers.length > rows) {
    const scroll = new NativeScrollbar(
      dialog.body,
      { x: 269, y: 21, extent: rows * 40, style: 0 },
      (position) =>
        purchaseRows(panel, dialog, offers.slice(position, position + rows)),
    );
    scroll.setRange(offers.length - rows + 1);
  }
  const rowY = 27 + rows * 40;
  cashText(dialog.body, "Total", { x: 18, y: rowY, width: 98 }, "#fff");
  const total = offers.reduce((sum, offer) => sum + offer.price, 0);
  cashText(
    dialog.body,
    `${total.toLocaleString()} NX`,
    { x: 119, y: rowY, width: 152 },
    "#fff",
  );
  const payment = paymentControls(panel, dialog, 62 + rows * 40);
  const error = cashText(
    dialog.body,
    "",
    { x: 12, y: height - 38, width: 260, height: 15 },
    "#a00000",
  );
  dialog.submit = () => {
    submitPurchase(panel, dialog, { sns, payment, error }).catch((failure) => {
      error.textContent = failure.message;
    });
  };
  dialog.body.button("BtOK2", 184, height - 24, {
    label: "Confirm purchase",
    action: dialog.submit,
  });
  dialog.body.button("BtCancel2", 232, height - 24, {
    label: "Cancel purchase",
    action: () => closeCashDialog(panel),
  });
}

async function submitPurchase(panel, dialog, controls) {
  if (panel.cashService.pending || panel.cashDialog !== dialog) return;
  const currency = controls.payment();
  panel.cashCurrency = currency;
  const result =
    controls.sns.length === 1
      ? await panel.cashService.buy({ sn: controls.sns[0], currency })
      : await panel.cashService.buyAvatar({ sns: controls.sns, currency });
  if (panel.disposed || panel.cashDialog !== dialog) return;
  if (result.ok) {
    closeCashDialog(panel);
    panel.owner.sound("BuyShopItem");
    panel.localRefresh();
  } else controls.error.textContent = result.reason;
}

async function buyMesoCommodity(panel, offer) {
  try {
    const name = cashTemplate(panel, offer.itemId)?.name ?? "this item";
    const accepted = await panel.owner.prompt({
      kind: "confirm",
      text: `Buy ${name} for ${offer.price.toLocaleString()} Mesos?`,
      owner: panel,
    });
    if (!accepted || panel.disposed) return;
    await cashOutcome(
      panel,
      panel.cashService.buy({ sn: offer.sn, currency: "meso" }),
    );
  } catch (error) {
    if (!panel.disposed) cashMessage(panel, error.message);
  }
}

function recipientList(panel, dialog, target, kind) {
  const social = panel.cashService.hooks.socialSnapshot?.();
  const members =
    kind === "friends"
      ? (social?.friends ?? [])
      : (social?.guild?.members ?? []);
  if (members.length > 32) throw new Error("Local gift recipient bound");
  dialog.recipients?.destroy();
  const layer = dialog.body.layer("Gift recipients");
  dialog.recipients = layer;
  dialog.body.width = 473;
  dialog.body.element.style.width = "473px";
  layer.image("CSGift/backgrnd1", 0, 0);
  dialog.body.root.setChildIndex(layer.root, 0);
  layer.button("CSGift/BtHide", 439, 139, {
    label: "Hide recipients",
    action: () => {
      layer.destroy();
      dialog.recipients = null;
      dialog.body.width = 266;
      dialog.body.element.style.width = "266px";
    },
  });
  const state = { members, target, offset: 0, rows: null };
  const scroll = new NativeScrollbar(
    layer,
    { x: 449, y: 18, extent: 119, style: 0 },
    (offset) => {
      state.offset = offset;
      drawRecipients(panel, layer, state);
    },
  );
  scroll.setRange(Math.max(1, members.length - 7 + 1));
  drawRecipients(panel, layer, state);
}

function drawRecipients(panel, layer, state) {
  state.rows?.destroy();
  const rows = layer.layer("Visible gift recipients");
  state.rows = rows;
  const end = Math.min(state.members.length, state.offset + 7);
  for (let index = state.offset; index < end; index++) {
    const store = panel.cashService.hooks.getParticipant?.(
      state.members[index].id,
    );
    if (!store) continue;
    const y = 20 + (index - state.offset) * 17;
    cashText(rows, store.profile.name, { x: 282, y, width: 153, height: 17 });
    rows.hit(
      `Gift to ${store.profile.name}`,
      { x: 282, y, width: 153, height: 17 },
      {
        click: () => {
          state.target.value = state.target.value
            ? `${state.target.value};${store.profile.name}`
            : store.profile.name;
        },
      },
    );
  }
}

function giftControls(dialog, recipient) {
  dialog.body.image("CSGift/backgrnd", 0, 0);
  // 007e2b10..1e: target84,52,122x13; message26,76/92,210x13.
  const target = cashInput(
    dialog.body,
    { x: 84, y: 52, width: 122, height: 13 },
    { label: "Recipient characters separated by semicolons", maxLength: 1022 },
  );
  target.value = recipient;
  const message = {
    first: cashInput(
      dialog.body,
      { x: 26, y: 76, width: 210, height: 13 },
      { label: "Gift message first line", maxLength: 34 },
    ),
    second: cashInput(
      dialog.body,
      { x: 26, y: 92, width: 210, height: 13 },
      { label: "Gift message second line", maxLength: 34 },
    ),
  };
  const error = cashText(
    dialog.body,
    "",
    { x: 14, y: 113, width: 237, height: 25 },
    "#a00000",
  );
  return { target, message, error };
}

/** Gift names resolve through the active service to actual, unambiguous recipient identities. */
export function cashGiftDialog(panel, sn, recipient = "", targetId = null) {
  const offer = panel.cashService.catalog.ui.cashShop.commodities[sn];
  if (!offer) return false;
  const dialog = beginCashDialog(panel, "Send cash gift", [266, 169]);
  if (!dialog) return false;
  const { target, message, error } = giftControls(dialog, recipient);
  // 007e2717: Guild56, Buddy110, OK168, Cancel210; all at139.
  dialog.body.button("CSGift/BtBuddy", 110, 139, {
    label: "Friends",
    action: () => recipientList(panel, dialog, target, "friends"),
  });
  dialog.body.button("CSGift/BtGuild", 56, 139, {
    label: "Guild",
    action: () => recipientList(panel, dialog, target, "guild"),
  });
  dialog.submit = () => {
    submitGift(panel, dialog, {
      sn,
      target,
      message,
      error,
      recipient,
      targetId,
    }).catch((failure) => {
      error.textContent = failure.message;
    });
  };
  dialog.body.button("BtOK2", 168, 139, {
    label: "Confirm gift",
    action: dialog.submit,
  });
  dialog.body.button("BtCancel2", 210, 139, {
    label: "Cancel gift",
    action: () => closeCashDialog(panel),
  });
  target.focus();
  return true;
}

async function giftTargets(panel, controls) {
  if (controls.targetId && controls.target.value === controls.recipient) {
    return [{ id: controls.targetId }];
  }
  const names = controls.target.value.split(";").map((name) => name.trim());
  try {
    return await panel.cashService.resolveRecipients(names);
  } catch (error) {
    controls.error.textContent = error.message;
    return null;
  }
}

async function submitGift(panel, dialog, controls) {
  if (panel.cashService.pending || panel.cashDialog !== dialog) return;
  const targets = await giftTargets(panel, controls);
  if (!targets || panel.disposed || panel.cashDialog !== dialog) return;
  const message =
    controls.message.first.value +
    (controls.message.second.value
      ? `\r\n${controls.message.second.value}`
      : "");
  const result = await panel.cashService.giftMany({
    sn: controls.sn,
    currency: "prepaid",
    targetIds: targets.map((target) => target.id),
    message,
  });
  if (panel.disposed || panel.cashDialog !== dialog) return;
  if (result.ok) {
    closeCashDialog(panel);
    panel.owner.sound("BuyShopItem");
  } else controls.error.textContent = result.reason;
}

/** One original commodity/package notice; every persisted instance claims atomically. */
export function cashGiftReceipt(panel, gift) {
  const dialog = beginCashDialog(panel, "Cash gift receipt", [266, 250]);
  if (!dialog) return;
  dialog.body.image("CSNotice/3/backgrnd", 0, 0);
  drawGiftReceiptItem(panel, dialog.body, gift);
  cashText(dialog.body, `${gift.senderName}: ${gift.message}`, {
    x: 23,
    y: 113,
    width: 219,
    height: 29,
  });
  const reply = cashInput(
    dialog.body,
    { x: 24, y: 183, width: 216, height: 16 },
    { label: "Reply to gift sender" },
  );
  reply.disabled = true;
  reply.title =
    "The original note-mail service is not connected; receiving this real local gift does not send a note.";
  const error = cashText(
    dialog.body,
    "",
    { x: 14, y: 206, width: 236, height: 17 },
    "#a00000",
  );
  dialog.submit = async () => {
    if (panel.cashService.pending) return;
    const result = await panel.cashService.claimGift(gift.uid);
    if (panel.disposed || panel.cashDialog !== dialog) return;
    if (result.ok) {
      closeCashDialog(panel);
      panel.cashNextGift?.();
    } else error.textContent = result.reason;
  };
  dialog.body.button("BtOK2", 158, 224, {
    label: "Receive gift",
    action: dialog.submit,
  });
  dialog.body.button("BtCancel2", 207, 224, {
    label: "Receive later",
    action: () => closeCashDialog(panel),
  });
}

function drawGiftReceiptItem(panel, body, gift) {
  const offer = panel.cashService.catalog.ui.cashShop.commodities[gift.sn];
  const template = offer ? cashTemplate(panel, offer.itemId) : null;
  replaceIcons(body, [{ template }], (layer) => {
    if (template) layer.image(template.iconPath, 39, 40);
    cashText(
      layer,
      template?.name ?? "Original gift item unavailable",
      { x: 101, y: 22, width: 139, height: 50 },
      "#fff",
    );
    layer.hit(
      "Gift item details",
      { x: 22, y: 22, width: 72, height: 72 },
      {},
      {
        tooltip: () =>
          offer
            ? cashTooltip(panel, offer, layer)
            : {
                title: "Gift",
                lines: [
                  {
                    text: "The original gift commodity record is unavailable.",
                    tone: "normal",
                  },
                ],
              },
      },
    );
  });
}

export function cashSearchDialog(panel) {
  const dialog = beginCashDialog(panel, "Search cash items", [265, 135]);
  if (!dialog) return;
  dialog.body.image("CSItemSearch/PopUp/backgrnd", 0, 0);
  const name = cashInput(
    dialog.body,
    { x: 104, y: 24, width: 138, height: 18 },
    { label: "Search item", value: panel.cashSearch, maxLength: 80 },
  );
  const price = cashInput(
    dialog.body,
    { x: 104, y: 48, width: 138, height: 18 },
    {
      label: "Maximum price",
      value:
        panel.cashMaximumPrice === null ? "" : String(panel.cashMaximumPrice),
      numeric: true,
      maxLength: 10,
    },
  );
  dialog.submit = () => {
    if (price.value && !/^\d{1,10}$/.test(price.value)) return;
    panel.cashSearch = name.value.trim();
    panel.cashMaximumPrice = price.value ? Number(price.value) : null;
    panel.cashPage = 0;
    closeCashDialog(panel);
    panel.localRefresh();
  };
  dialog.body.button("BtOK2", 151, 101, {
    label: "Search",
    action: dialog.submit,
  });
  dialog.body.button("CSItemSearch/BtCancel", 202, 101, {
    label: "Cancel search",
    action: () => closeCashDialog(panel),
  });
  name.focus();
}
