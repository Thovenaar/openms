import { NativeAvatarPortrait } from "../ui/ui-avatar-portrait.js";
import { nativeOutcome } from "./native-source.js";

/** Adapt only the public allowlisted fields required by the original UserInfo renderer. */
function peerStore(peer) {
  return {
    id: peer.identity.id,
    profile: {
      name: peer.name,
      level: peer.level,
      job: peer.job,
      fame: peer.fame,
      gender: peer.gender,
      appearance: peer.appearance,
      equipment: peer.equipment,
      social: { guild: peer.guild, alliance: peer.alliance },
      cash: { wishlist: peer.wishlist },
      monsterBook: {
        cover: peer.book.cover,
        cards: Object.fromEntries(
          peer.book.cards.map((card) => [card.id, card.count]),
        ),
      },
      quests: Object.fromEntries(peer.medals.map((id) => [id, { state: 2 }])),
    },
  };
}

function playerAt(scene, x, y) {
  let selected = null,
    depth = -Infinity;
  if (scene.views.size > 4096) {
    throw new Error("Player selection exceeds the resident entity limit.");
  }
  for (const view of scene.views.values()) {
    if (view.entity.kind !== "player" || !view.animation.container.visible) continue;
    const bounds = view.animation.container.getBounds();
    if (
      x < bounds.x ||
      x >= bounds.x + bounds.width ||
      y < bounds.y ||
      y >= bounds.y + bounds.height
    ) continue;
    const z = view.animation.container.zIndex;
    if (z >= depth) {
      selected = view.entity.id;
      depth = z;
    }
  }
  return selected;
}

export class NativeSocialPeers {
  constructor(social) {
    this.social = social;
    this.owner = social.owner;
    this.selected = null;
    this.familyTreeId = null;
    this.request = 0;
  }
  selectedId() {
    return this.selected?.id ?? null;
  }
  selectedStore() {
    if (!this.selected)
      {throw new Error("Select an available server character first.");}
    return this.selected.id === this.owner.store.id
      ? this.owner.store
      : this.selected;
  }
  publish(peer) {
    if (!this.selected) return;
    if (!peer || peer.identity.id !== this.selected.id) {
      this.selected = null;
      this.owner.ui.close("UserInfo", true);
      return;
    }
    this.selected = peerStore(peer);
    this.owner.ui.windows.get("UserInfo")?.localRefresh();
  }
  async openUserInfo(id = this.owner.store.id) {
    const token = ++this.request;
    const receipt = await this.owner.command({
      kind: "social.peer",
      targetId: id,
    });
    const outcome = nativeOutcome(receipt);
    if (!outcome.ok) return outcome;
    if (receipt.value?.kind !== "social.peer" || receipt.value.targetId !== id)
      {throw new Error("The server returned a different selected character.");}
    const view = await this.social.waitForProjection(
      receipt.value.projectionId,
    );
    if (token !== this.request || this.social.closed)
      {return { ok: false, code: "cancelled" };}
    if (view.selectedPeer?.identity.id !== id)
      {return {
        ok: false,
        reason: "The selected public character is no longer available.",
      };}
    this.selected = peerStore(view.selectedPeer);
    const panel = await this.owner.ui.open("UserInfo");
    panel.localRefresh();
    this.owner.ui.front(panel);
    return { ok: true };
  }
  async openUserInfoAt(clientX, clientY) {
    if (this.social.busy || this.owner.ui.blocksGameplay()) return false;
    const scene = this.owner.hooks.scene();
    const rect = this.owner.app.canvas.getBoundingClientRect();
    if (!scene || rect.width <= 0 || rect.height <= 0) return false;
    const x =
      ((clientX - rect.left) * this.owner.app.screen.width) / rect.width;
    const y =
      ((clientY - rect.top) * this.owner.app.screen.height) / rect.height;
    const selected = playerAt(scene, x, y);
    return selected ? (await this.openUserInfo(selected)).ok : false;
  }
  sameSelection(profile) {
    return Boolean(this.selected && this.selectedStore().profile === profile);
  }
  async openFamily(profile) {
    if (!this.sameSelection(profile))
      {return { ok: false, reason: "The selected character changed." };}
    if (this.selected.id !== this.owner.store.id)
      {return this.openFamilyTree(this.selected.id);}
    await this.owner.ui.open("Family");
    return { ok: true };
  }
  inviteParty(profile) {
    if (
      !this.sameSelection(profile) ||
      this.selected.id === this.owner.store.id
    )
      {return { ok: false, reason: "Select another available character." };}
    return this.social.execute("party.invite", { targetId: this.selected.id });
  }
  async giftWish(profile, sn) {
    if (
      !this.sameSelection(profile) ||
      this.selected.id === this.owner.store.id ||
      !profile.cash.wishlist.includes(sn)
    )
      {return {
        ok: false,
        reason: "Select another character's public wish-list item.",
      };}
    const name = profile.name,
      targetId = this.selected.id;
    const panel = await this.owner.ui.open("CashShop");
    return panel.cashOpenGift(sn, name, targetId)
      ? { ok: true }
      : {
          ok: false,
          reason: "Finish or cancel the current gift dialog first.",
        };
  }
  async openFamilyTree(id = this.owner.store.id) {
    const outcome = await this.social.read("", id);
    if (!outcome.ok) return outcome;
    this.familyTreeId = id;
    const panel = await this.owner.ui.open("FamilyTree");
    const result = panel.setFamilyRoot(id);
    if (result.ok) this.owner.ui.front(panel);
    return result;
  }
  async togglePartyHP(enabled) {
    if (enabled && !this.owner.store.profile.social.party)
      {return { ok: false, reason: "The character is not in a party." };}
    if (enabled) await this.owner.ui.open("PartyHP");
    else this.owner.ui.close("PartyHP", true);
    return { ok: true };
  }
  portrait(surface, position) {
    return new NativeAvatarPortrait(surface, this.owner.avatars, position);
  }
  socialPortrait({ layer, member, x, y }) {
    const participant = this.social.getParticipant(member.id);
    if (!participant)
      {throw new Error("The server has not published this Messenger member.");}
    const portrait = this.portrait(layer, { x, y, id: participant.id });
    portrait.useSurfaceClock();
    portrait.refresh(participant.profile).catch((error) => {
      if (error.name !== "AbortError") this.owner.report(error);
    });
    return portrait;
  }
  nativeHooks() {
    return {
      userInfoProfile: () => this.selectedStore().profile,
      userInfoPortrait: (surface, position) => this.portrait(surface, position),
      userInfoFamily: (profile) => this.openFamily(profile),
      userInfoParty: (profile) => this.inviteParty(profile),
      userInfoGift: (profile, sn) => this.giftWish(profile, sn),
      openUserInfoAt: (x, y) => this.openUserInfoAt(x, y),
      socialOpenUserInfo: (id) => this.openUserInfo(id),
      openFamilyTree: (id) => this.openFamilyTree(id),
      familyTreeTarget: () => this.familyTreeId,
      socialPortrait: (options) => this.socialPortrait(options),
      openLocalTrade: (id) => {
        const target = id ?? this.selectedId();
        return target && target !== this.owner.store.id
          ? this.owner.inviteTrade(target)
          : { ok: false, reason: "Select another character to trade with." };
      },
    };
  }
  destroy() {
    this.request++;
    this.selected = null;
    this.familyTreeId = null;
  }
}
