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
  invitationArtwork(panel, {
    title: "Trade request",
    sender: trade.stores[0].profile.name,
    icon: 2,
    answer: (accepted) => answerInvitation(panel, accepted),
  });
  panel.requestClose = () => trade.decline(1);
  panel.invitationUpdate = () => updateInvitation(panel);
  panel.cleanups.push(trade.subscribe(() => settleInvitation(panel)));
  panel.cleanups.push(() => {
    if (!panel.invitationHandoff) {
      Promise.resolve(trade.cancel(1)).catch((error) =>
        panel.owner.report(error),
      );
    }
  });
  updateInvitation(panel);
}

/** 005203bb and decoded strings763..769 share FadeYesNo across social requests. */
function invitationArtwork(panel, options) {
  panel.image("FadeYesNo/backgrnd", 0, 0);
  panel.image(`FadeYesNo/icon${options.icon}`, 6, 9);
  const title = panel.text(options.title, 25, 5, 148);
  const sender = panel.text(`from '${options.sender}'`, 25, 18, 148);
  title.title = options.detail || options.title;
  sender.title = `from '${options.sender}'`;
  for (const text of [title, sender]) {
    text.style.cssText +=
      "font:12px Arial,sans-serif;line-height:13px;color:#fff;white-space:nowrap;overflow:hidden;";
  }
  panel.button("FadeYesNo/BtOK", 177, 7, {
    label: `Accept ${options.detail || options.title.toLowerCase()}`,
    tooltip: `${options.detail || options.title} from '${options.sender}'`,
    action: () => options.answer(true),
  });
  panel.button("FadeYesNo/BtCancel", 177, 20, {
    label: `Decline ${options.detail || options.title.toLowerCase()}`,
    tooltip: `${options.detail || options.title} from '${options.sender}'`,
    action: () => options.answer(false),
  });
}

/** Presentation only: the caller retains the checked LocalSocial accept/decline operation. */
export function layoutSocialInvitation(panel, invitation) {
  if (!invitation?.request || typeof invitation.answer !== "function") {
    throw new Error("The active character has no incoming social invitation.");
  }
  const request = invitation.request;
  panel.nativeClose = true;
  panel.invitationOpenedAt = panel.owner.hooks.now?.() ?? performance.now();
  panel.invitationAlpha = -1;
  panel.invitationSettling = false;
  const answer = (accepted) => {
    if (panel.disposed || panel.invitationSettling) return;
    panel.invitationSettling = true;
    panel.owner.close(panel.name, true);
    invitation.answer(accepted);
  };
  const presentation = socialInvitationPresentation(request.kind);
  invitationArtwork(panel, {
    ...presentation,
    sender: request.fromName,
    detail: `${request.kind}${request.groupName ? ` (${request.groupName})` : ""}`,
    answer,
  });
  panel.requestClose = () => answer(false);
  panel.invitationUpdate = () => {
    if (panel.disposed || panel.invitationSettling) return;
    const now = panel.owner.hooks.now?.() ?? performance.now();
    const elapsed = Math.max(0, now - panel.invitationOpenedAt);
    if (elapsed > INVITATION_MS) return answer(false);
    const alpha = Math.min(255, Math.trunc((elapsed * 255) / FADE_MS));
    if (alpha !== panel.invitationAlpha) {
      panel.invitationAlpha = alpha;
      panel.element.style.opacity = OPACITY[alpha];
    }
  };
  panel.cleanups.push(() => {
    if (!panel.invitationSettling) invitation.answer(null);
  });
  panel.invitationUpdate();
  // 00522cf4/00522ee6/005233da: string0x4d3 -> ordinary UI/Invite.
  // The request owner survives panel repaint; autoplay refusal is not deferred/retried.
  if (!invitation.soundPlayed) {
    invitation.soundPlayed = true;
    panel.owner.sound("Invite");
  }
}

function socialInvitationPresentation(kind) {
  switch (kind) {
    case "friend":
      return { title: "Buddy request", icon: 1 };
    case "party":
      return { title: "Party invite", icon: 3 };
    case "guild":
      return { title: "Guild invite", icon: 4 };
    case "guild-create":
      return { title: "Found a guild", icon: 4 };
    case "alliance":
      return { title: "Alliance invite", icon: 4 };
    case "alliance-create":
      return { title: "Found an alliance", icon: 4 };
    case "family":
      return { title: "Family invitation", icon: 5 };
    case "family-summon":
      return { title: "Family summon", icon: 5 };
    case "messenger":
      return { title: "An invitation", icon: 0 };
    default:
      throw new Error(`Unsupported social invitation kind: ${kind}`);
  }
}

async function answerInvitation(panel, accepted) {
  if (panel.disposed || panel.invitationSettling) return;
  panel.invitationSettling = true;
  try {
    const result = await (accepted
      ? panel.trade.accept(1)
      : panel.trade.decline(1));
    if (!result.ok) panel.owner.status(result.reason);
  } catch (error) {
    panel.owner.report(error);
  } finally {
    panel.invitationSettling = false;
    settleInvitation(panel);
  }
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
