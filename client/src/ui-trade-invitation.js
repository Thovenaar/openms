// Original00522f14 /005203bb /0052065d: type2 FadeYesNo, not the barter-confirmation dialog.
const FADE_MS = 1000;
const INVITATION_MS = 180000;
const OPACITY = Array.from({ length: 256 }, (_, alpha) => String(alpha / 255));

/** Active invitee only. The same LocalTrade authority owns acceptance, cancellation and handoff. */
export function layoutTradeInvitation(panel, trade) {
  if (
    trade.state !== "invited" ||
    trade.stores[1].id !== panel.owner.store.id
  ) {
    throw new Error("The active character has no incoming trade invitation.");
  }
  panel.nativeClose = true;
  panel.trade = trade;
  panel.invitationHandoff = false;
  panel.invitationSettling = false;
  panel.invitationOpenedAt = panel.owner.hooks.now?.() ?? performance.now();
  panel.invitationAlpha = -1;
  panel.image("FadeYesNo/backgrnd", 0, 0);
  panel.image("FadeYesNo/icon2", 6, 9);
  const title = panel.text("Trade request", 25, 5, 148);
  const sender = panel.text(
    `from '${trade.stores[0].profile.name}'`,
    25,
    18,
    148,
  );
  for (const text of [title, sender]) {
    text.style.cssText +=
      "font:12px Arial,sans-serif;line-height:13px;color:#fff;white-space:nowrap;overflow:hidden;";
  }
  panel.button("FadeYesNo/BtOK", 177, 7, {
    label: "Accept trade invitation",
    action: () => answerInvitation(panel, true),
  });
  panel.button("FadeYesNo/BtCancel", 177, 20, {
    label: "Decline trade invitation",
    action: () => answerInvitation(panel, false),
  });
  panel.requestClose = () => trade.decline(1);
  panel.invitationUpdate = () => updateInvitation(panel);
  panel.cleanups.push(trade.subscribe(() => settleInvitation(panel)));
  panel.cleanups.push(() => {
    if (!panel.invitationHandoff) trade.cancel(1);
  });
  updateInvitation(panel);
}

function answerInvitation(panel, accepted) {
  if (panel.disposed || panel.invitationSettling) return;
  const result = accepted ? panel.trade.accept(1) : panel.trade.decline(1);
  if (!result.ok) panel.owner.status(result.reason);
}

/** Queue retirement outside LocalTrade's synchronous observer traversal. */
function settleInvitation(panel) {
  if (
    panel.disposed ||
    panel.invitationSettling ||
    panel.trade.state === "invited"
  ) {
    return;
  }
  panel.invitationSettling = true;
  queueMicrotask(() => {
    if (panel.disposed) return;
    const trade = panel.trade;
    panel.invitationHandoff = trade.state === "open";
    panel.owner.close(panel.name, true);
    if (panel.invitationHandoff) {
      panel.owner.open("TradingRoom").catch((error) => {
        trade.destroy().catch((failure) => panel.owner.report(failure));
        panel.owner.report(error);
      });
    }
  });
}

/** Original entrance duration and three-minute lifetime; browser retirement is immediate on reply. */
function updateInvitation(panel) {
  if (panel.disposed || panel.invitationSettling) return;
  const now = panel.owner.hooks.now?.() ?? performance.now();
  const elapsed = Math.max(0, now - panel.invitationOpenedAt);
  if (elapsed > INVITATION_MS) {
    answerInvitation(panel, false);
    return;
  }
  const alpha = Math.min(255, Math.trunc((elapsed * 255) / FADE_MS));
  if (alpha !== panel.invitationAlpha) {
    panel.invitationAlpha = alpha;
    panel.element.style.opacity = OPACITY[alpha];
  }
}
