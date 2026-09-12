import { TRADE_SLOTS, tradeFee } from "../social/local-trade-rules.js";
import { replaceIcons, drawItemCount } from "./ui-icons.js";
import { itemTooltip } from "./ui-tooltip.js";
import { NativeScrollbar } from "./ui-scrollbar.js";

const CHAT = Object.freeze({ x: 295, y: 25, width: 237, height: 192 });
const ENDED = new Set(["completed", "cancelled", "declined", "failed"]);

/** Ordinary EXE007c3b52 hit rectangles. Native participant-local offers are on the RIGHT. */
export function tradingSlotRect(local, slot) {
  if (
    typeof local !== "boolean" ||
    !Number.isInteger(slot) ||
    slot < 1 ||
    slot > TRADE_SLOTS
  ) {
    throw new Error("Invalid ordinary trade slot");
  }
  const index = slot - 1;
  return {
    x: (local ? 172 : 10) + (index % 3) * 39,
    y: 131 + Math.floor(index / 3) * 37,
    width: 32,
    height: 32,
  };
}

/** Main owns room dispatch and the separately labelled peer simulator. No peer-acting controls here.
 * owner.hooks.tradePortrait(layer,{id,profile,x,y})->NativeAvatarPortrait renders the real saved avatar.
 * owner.hooks.tradeCarry(panel,{side,slot,trade}) optionally resolves an existing carry click.
 * panel.offerCarriedItem({uid},slot) is the direct cursor destination adapter; no inventory debit.
 * owner.hooks.tradeOutcome(result) owns native modal errors/results, outside this room's artwork.
 */
export function layoutTradingRoom(panel, trade) {
  const side = trade.stores.findIndex(
    (store) => store.id === panel.owner.store.id,
  );
  if (side < 0) {
    throw new Error("The active character is not a participant in this trade.");
  }
  panel.trade = trade;
  panel.tradeSide = side;
  panel.nativeClose = true;
  panel.width = panel.assets["TradingRoom/backgrnd"].width;
  panel.height = panel.assets["TradingRoom/backgrnd"].height;
  panel.element.style.width = `${panel.width}px`;
  panel.element.style.height = `${panel.height}px`;
  panel.image("TradingRoom/backgrnd", 0, 0);
  panel.tradeValues = [null, null];
  panel.tradeSlots = [];
  panel.tradeLocks = [];
  panel.offerCarriedItem = (proposal, slot) =>
    runTradeAction(panel, trade.promptItem(side, { uid: proposal.uid, slot }));
  createParticipant(panel, side);
  createParticipant(panel, 1 - side);
  createControls(panel);
  createChat(panel);
  panel.localRefresh = () => refreshTradingRoom(panel);
  panel.cleanups.push(trade.subscribe(panel.localRefresh));
  // UISurface teardown settles the authority even when a map change destroys the DOM directly.
  panel.cleanups.push(() => {
    trade.destroy().catch((error) => panel.owner.report(error));
  });
  panel.canClose = () => trade.state !== "committing";
  panel.requestClose = () => trade.cancel(side);
  refreshTradingRoom(panel);
}

function createParticipant(panel, side) {
  const local = side === panel.tradeSide;
  const store = panel.trade.stores[side];
  const portrait = panel.layer(`Trade participant ${side}`);
  const hook = panel.owner.hooks.tradePortrait;
  if (typeof hook !== "function") {
    throw new Error(
      "The real saved-character trade portrait renderer is unavailable.",
    );
  }
  const lease = hook(portrait, {
    id: store.id,
    profile: store.profile,
    x: local ? 227 : 66,
    y: 101,
  });
  if (!lease || typeof lease.destroy !== "function") {
    throw new Error("The trade portrait renderer must return an owned lease.");
  }
  portrait.cleanups.push(() => lease.destroy());
  lease.useSurfaceClock();
  const name = panel.text(store.profile.name, local ? 184 : 19, 107, 86);
  name.style.cssText +=
    "text-align:center;white-space:nowrap;overflow:hidden;color:white;line-height:13px;font:12px Arial,sans-serif;";
  const mesos = panel.text("0", local ? 187 : 24, 243, 90);
  const net = panel.text("0", local ? 187 : 24, 259, 90);
  for (const field of [mesos, net]) {
    field.style.cssText +=
      "text-align:right;white-space:nowrap;line-height:13px;font:12px Arial,sans-serif;";
  }
  panel.tradeValues[side] = { name, mesos, net, portrait, lease };
  for (let slot = 1; slot <= TRADE_SLOTS; slot++) {
    createOfferHit(panel, side, slot);
  }
  // 007c32ed/007c3336 FillRect: ARGB80ffffff, local169/peer6, y129,113x109.
  const lock = document.createElement("div");
  lock.setAttribute(
    "aria-label",
    `${local ? "Your" : "Partner's"} offer locked`,
  );
  lock.style.cssText = `position:absolute;left:${local ? 169 : 6}px;top:129px;width:113px;height:109px;background:rgba(255,255,255,0.5019607843137255);pointer-events:none;z-index:2;`;
  lock.hidden = true;
  panel.element.append(lock);
  panel.tradeLocks[side] = lock;
}

function createOfferHit(panel, side, slot) {
  const local = side === panel.tradeSide;
  const rect = tradingSlotRect(local, slot);
  const hit = panel.hit(
    `${local ? "Your" : "Partner's"} trade slot ${slot}`,
    rect,
    local
      ? {
          click: () => {
            const hook = panel.owner.hooks.tradeCarry;
            if (hook) {
              Promise.resolve(
                hook(panel, { side, slot, trade: panel.trade }),
              ).catch((error) => panel.owner.report(error));
            }
          },
        }
      : {},
  );
  hit.dataset.tradeSide = String(side);
  hit.dataset.tradeSlot = String(slot);
  panel.tradeSlots.push({ side, slot, hit });
}

function createControls(panel) {
  const trade = panel.trade;
  const side = panel.tradeSide;
  panel.tradeConfirm = panel.button("TradingRoom/BtTrade", 116, 49, {
    label: "Trade",
    action: () => runTradeAction(panel, trade.confirm(side)),
  });
  panel.tradeCancel = panel.button("TradingRoom/BtReset", 116, 71, {
    label: "Cancel trade",
    action: () => runTradeAction(panel, trade.cancel(side)),
  });
  panel.tradeCoin = panel.button("TradingRoom/BtCoin", 170, 244, {
    label: "Offer mesos",
    action: () => runTradeAction(panel, trade.promptMesos(side)),
  });
  // 007c2542 constructs the shared report control. Reporting requires moderation authority.
  panel.button("BtClaim", 494, 241, {
    label: "Report",
    disabled: true,
    tooltip:
      "Player reports require a connected moderation service; local saved characters are not remote accounts.",
  });
}

function createChat(panel) {
  const log = panel.contentArea(CHAT.x, CHAT.y, CHAT.width, CHAT.height);
  log.setAttribute("role", "log");
  log.setAttribute("aria-label", "Trade conversation");
  log.style.cssText +=
    "overflow:hidden;font:12px Arial,sans-serif;line-height:13px;white-space:pre-wrap;overflow-wrap:break-word;";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 256;
  input.setAttribute("aria-label", "Trade message");
  input.style.cssText =
    "position:absolute;left:296px;top:245px;width:192px;height:15px;border:0;padding:0;background:transparent;color:black;font:12px Arial,sans-serif;line-height:15px;";
  panel.element.append(input);
  panel.tradeChat = { log, input, signature: "", scroll: null };
  const scroll = new NativeScrollbar(
    panel,
    { x: 542, y: 23, extent: 192, style: 3 },
    (position) => {
      log.scrollTop = position;
    },
  );
  panel.tradeChat.scroll = scroll;
  panel.tradeSend = panel.button("Messenger/BtEnter", 520, 244, {
    label: "Send trade message",
    action: () => sendMessage(panel),
  });
  panel.listen(input, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage(panel);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      input.blur();
      panel.owner.hooks.focusGame();
    }
  });
  panel.listen(input, "keyup", (event) => event.stopPropagation());
  panel.listen(input, "blur", () => panel.owner.hooks.clearInput());
}

function sendMessage(panel) {
  const chat = panel.tradeChat;
  const outcome = panel.trade.sendChat(panel.tradeSide, chat.input.value);
  if (outcome.ok) chat.input.value = "";
  else showOutcome(panel, outcome);
}

function refreshChat(panel, snapshot) {
  const chat = panel.tradeChat;
  const signature = JSON.stringify(snapshot.messages);
  if (signature !== chat.signature) {
    const pinned = chat.scroll.position === chat.scroll.count - 1;
    chat.signature = signature;
    chat.log.replaceChildren();
    for (const message of snapshot.messages) {
      const row = document.createElement("div");
      row.textContent = `${message.name} : ${message.text}`;
      chat.log.append(row);
    }
    const count = Math.max(1, chat.log.scrollHeight - CHAT.height + 1);
    chat.scroll.setRange(count, pinned ? count - 1 : chat.scroll.position);
    chat.log.scrollTop = chat.scroll.position;
  }
  chat.input.disabled = snapshot.state !== "open" || snapshot.chatSupported === false;
  panel.tradeSend.setDisabled(chat.input.disabled);
  if (chat.input.disabled && document.activeElement === chat.input) {
    chat.input.blur();
  }
}

function refreshTradingRoom(panel) {
  if (panel.disposed) return;
  const snapshot = panel.trade.snapshot();
  const self = snapshot.participants[panel.tradeSide];
  const canEdit = snapshot.state === "open" && !self.locked && !self.prompting;
  panel.tradeConfirm.setDisabled(!canEdit);
  panel.tradeCoin.setDisabled(!canEdit || self.wallet <= self.mesos);
  panel.tradeCancel.setDisabled(
    snapshot.state === "committing" || ENDED.has(snapshot.state),
  );
  for (const participant of snapshot.participants) {
    refreshTradeParticipant(panel, participant, snapshot.state);
  }
  for (const record of panel.tradeSlots) {
    record.hit.disabled =
      record.side === panel.tradeSide &&
      (!canEdit || Boolean(self.offers[record.slot - 1]));
  }
  refreshChat(panel, snapshot);
  refreshOffers(panel, snapshot);
  panel.renderArtwork();
  if (ENDED.has(snapshot.state) && panel.tradeTerminal !== snapshot.state) {
    panel.tradeTerminal = snapshot.state;
    // Never close a room in its own synchronous observer traversal.
    queueMicrotask(() => {
      if (!panel.disposed) panel.owner.close(panel.name, true);
      showOutcome(panel, snapshot.result);
    });
  }
}

function refreshTradeParticipant(panel, participant, state) {
  const fields = panel.tradeValues[participant.side];
  fields.lease
    .refresh(panel.trade.stores[participant.side].profile)
    .catch((error) => {
      if (error.name !== "AbortError" && !panel.disposed) {
        panel.owner.report(error);
      }
    });
  fields.name.textContent = participant.name;
  fields.mesos.textContent = participant.mesos.toLocaleString("en-US");
  fields.net.textContent = (
    participant.mesos - tradeFee(participant.mesos)
  ).toLocaleString("en-US");
  const present = participant.side === panel.tradeSide || state !== "invited";
  fields.portrait.root.visible = present;
  fields.name.hidden = !present;
  panel.tradeLocks[participant.side].hidden = !participant.locked;
}

function refreshOffers(panel, snapshot) {
  const signature = JSON.stringify(
    snapshot.participants.map((participant) => participant.offers),
  );
  if (signature === panel.tradeOfferSignature) return;
  panel.tradeOfferSignature = signature;
  const records = [];
  for (const participant of snapshot.participants) {
    for (const offer of participant.offers) {
      if (!offer) continue;
      records.push({
        ...offer.item,
        count: offer.count,
        tradeSlot: offer.slot,
        side: participant.side,
        template: panel.trade.catalog.ui.items[offer.item.id],
      });
    }
  }
  replaceIcons(panel, records, (layer, entry) =>
    drawOffer(panel, layer, entry),
  ).catch((error) => panel.owner.report(error));
}

function drawOffer(panel, layer, entry) {
  const rect = tradingSlotRect(entry.side === panel.tradeSide, entry.tradeSlot);
  const path = entry.template.iconPath;
  // 007c33cb draws one pixel left/two pixels above the 007c3b52 hit rectangle.
  layer.image(path, rect.x - 1, rect.y + 30, true);
  if (Math.floor(entry.id / 1000000) !== 1) {
    drawItemCount(layer, entry.count, {
      ...rect,
      x: rect.x - 1,
      y: rect.y - 2,
    });
  }
  layer.hit(
    `${entry.template.name} × ${entry.count}`,
    rect,
    {},
    {
      tooltip: () => offerTooltip(panel, layer, entry),
    },
  );
}

function offerTooltip(panel, layer, entry) {
  const owner = { store: panel.trade.stores[entry.side] };
  const tooltip = itemTooltip(owner, entry.template, entry.id, {
    uid: entry.uid,
    quantity: entry.count,
  });
  if (entry.flags & (Math.floor(entry.id / 1000000) === 1 ? 0x10 : 0x02)) {
    tooltip.lines.push({
      text: "Can trade 1 time (Trade disabled after transaction)",
      tone: "warning",
    });
  }
  if (entry.owner) tooltip.lines.push({ text: entry.owner, tone: "normal" });
  if (entry.expiresAt !== null && entry.expiresAt !== undefined) {
    tooltip.lines.push({
      text: `Expires: ${new Date(entry.expiresAt).toLocaleString()}`,
      tone: "warning",
    });
  }
  return {
    ...tooltip,
    source: { surface: layer, path: entry.template.iconPath },
  };
}

async function runTradeAction(panel, action) {
  try {
    const result = await action;
    if (
      !result.ok &&
      result.code !== "prompt-cancelled" &&
      !ENDED.has(panel.trade.state)
    ) {
      showOutcome(panel, result);
    }
    return result;
  } catch (error) {
    panel.owner.report(error);
    return {
      ok: false,
      code: error.code ?? "trade-ui-error",
      reason: error.message,
    };
  }
}

function showOutcome(panel, result) {
  if (
    !result ||
    (result.code === "trade-cancelled" && result.side === panel.tradeSide)
  ) {
    return;
  }
  const presentation = tradeOutcomePresentation(result, panel.tradeSide);
  const hook = panel.owner.hooks.tradeOutcome;
  if (hook) {
    Promise.resolve(hook({ ...result, ...presentation })).catch((error) =>
      panel.owner.report(error),
    );
  } else if (!result.ok) {
    panel.owner.report(new Error(result.reason ?? result.code));
  }
}

/** 007c221d selects these original pool strings only after the terminal room result. */
function tradeOutcomePresentation(result, side) {
  if (result.code === "trade-completed") {
    const received = result.netReceived[side];
    return received > 0
      ? {
          stringId: 0x198,
          text: `Trade successful.\r\nReceived ${received} mesos after fees.\r\nPlease check the results.`,
        }
      : {
          stringId: 0x197,
          text: "Trade successful.\r\nPlease check the results.",
        };
  }
  if (result.code === "trade-cancelled" || result.code === "trade-declined") {
    return {
      stringId: 0x196,
      text: "Trade cancelled.\r\nby the other character.",
    };
  }
  if (result.code === "unique-item") {
    return {
      stringId: 0x19a,
      text: "You cannot make the trade because\r\nthere are some items which\r\nyou cannot carry more than one.",
    };
  }
  if (result.code === "trade-map") {
    return {
      stringId: 0x19b,
      text: "You cannot make the trade because\r\nthe other person's on a different map.",
    };
  }
  return {
    text: result.reason ?? "Trade unsuccessful.",
    stringId: result.reason ? null : 0x199,
  };
}
