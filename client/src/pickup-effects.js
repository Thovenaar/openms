import { applyItemVitals, inspectItemSpec } from "./item-effects.js";
import { itemConditionsMatch } from "./item-conditions.js";
import { profileError } from "./profile-validation.js";

const MAX_PICKUP_QUANTITY = 32767;

/** Field-owned adapter over SkillSystem.effects, never another buff engine.
 * owner={store,items,skills,view,isCurrent,conditionContext}; the context describes
 * authenticated same-map participants, not a social membership list or a mock party.
 * DropSystem alone credits the card/consumes the ground instance in its durable draft.
 */
export class PickupEffects {
  constructor(owner) {
    this.owner = owner;
    this.store = owner.store;
    this.pending = null;
    this.destroyed = false;
    this.conditionContext = {
      mapId: owner.conditionContext.mapId,
      partyHunting: owner.conditionContext.partyHunting,
    };
  }

  admission(profile) {
    if (
      this.destroyed ||
      !this.owner.isCurrent() ||
      this.owner.skills.destroyed ||
      this.owner.skills.store !== this.store ||
      !profile ||
      profile.hp <= 0
    ) {
      throw profileError(
        "pickup-cancelled",
        "The pickup effect's living character or field owner is unavailable.",
      );
    }
    if (Number(profile.location.mapId) !== this.conditionContext.mapId) {
      throw profileError(
        "pickup-map-changed",
        "The pickup effect's source map changed.",
      );
    }
  }

  /** Rebind after skills.inherit; the old field must never refresh the transferred authority. */
  refreshConditions(context = this.conditionContext) {
    if (this.destroyed) return null;
    this.owner.skills.effects.refreshConditions(context);
    this.conditionContext.mapId = context.mapId;
    this.conditionContext.partyHunting = context.partyHunting;
    return this.owner.skills.effects.unavailableCondition();
  }

  inspectDropEffect(drop) {
    if (
      !Number.isInteger(drop.quantity) ||
      drop.quantity < 1 ||
      drop.quantity > MAX_PICKUP_QUANTITY ||
      !drop.instance ||
      drop.instance.id !== drop.itemId ||
      drop.instance.count !== drop.quantity
    ) {
      throw profileError(
        "invalid-pickup-effect",
        "The original ground item instance is invalid.",
      );
    }
    const effect = inspectItemSpec(this.owner.items[drop.itemId]);
    if (!effect.pickup) {
      throw profileError(
        "invalid-pickup-effect",
        "This original item is not consume-on-pickup.",
      );
    }
    if (effect.card && drop.quantity !== 1) {
      throw profileError(
        "invalid-card-drop",
        "A monster card drop must contain one card.",
      );
    }
    return effect;
  }

  async prepare(drop) {
    this.admission(this.store.profile);
    if (this.pending || this.store.profileTransactionPending) {
      throw profileError(
        "pickup-busy",
        "A pickup or profile operation is already pending.",
      );
    }
    const effect = this.inspectDropEffect(drop);
    this.refreshConditions();
    this.effectAdmission(effect);
    const prepared = {
      controller: this,
      effect,
      reservation: null,
      published: false,
      released: false,
      mapId: this.conditionContext.mapId,
      partyHunting: this.conditionContext.partyHunting,
    };
    this.pending = prepared;
    try {
      if (effect.state) await this.prepareTemporary(prepared);
      this.admission(this.store.profile);
      return prepared;
    } catch (error) {
      this.release(prepared);
      throw error;
    }
  }

  effectAdmission(effect) {
    const matches = itemConditionsMatch(
      effect.conditions,
      this.conditionContext,
    );
    if (matches && effect.unavailable) {
      throw profileError("pickup-effect-unavailable", effect.unavailable);
    }
    if (effect.values.party && this.conditionContext.partyHunting) {
      throw profileError(
        "pickup-party-unavailable",
        "Original party pickup effects require a same-map multi-character vital transaction.",
      );
    }
  }

  async prepareTemporary(prepared) {
    const authority = this.owner.skills.effects;
    const state = prepared.effect.state;
    prepared.reservation = authority.reserve(state);
    if (
      !this.owner.view ||
      typeof this.owner.view.prepareSource !== "function"
    ) {
      throw profileError(
        "pickup-artwork-unavailable",
        "Original pickup effect icon preparation is unavailable.",
      );
    }
    await this.owner.view.prepareSource("item", state.id);
    if (
      authority.destroyed ||
      authority !== this.owner.skills.effects ||
      authority.reservation !== prepared.reservation ||
      this.pending !== prepared
    ) {
      throw profileError(
        "pickup-cancelled",
        "Temporary pickup effect preparation was cancelled.",
      );
    }
  }

  /** May run twice on detached drafts. No publication, sampling, allocation, or debit here. */
  apply(draft, prepared) {
    this.admission(draft);
    if (
      this.pending !== prepared ||
      prepared.controller !== this ||
      prepared.published ||
      prepared.released ||
      prepared.mapId !== this.conditionContext.mapId ||
      prepared.partyHunting !== this.conditionContext.partyHunting
    ) {
      throw profileError(
        "pickup-cancelled",
        "Prepared pickup ownership or conditions changed.",
      );
    }
    const reservation = prepared.reservation;
    if (
      reservation &&
      (reservation.authority !== this.owner.skills.effects ||
        reservation.authority.destroyed ||
        reservation.authority.reservation !== reservation)
    ) {
      throw profileError(
        "pickup-cancelled",
        "Prepared temporary authority is no longer reserved.",
      );
    }
    this.effectAdmission(prepared.effect);
    if (
      itemConditionsMatch(prepared.effect.conditions, this.conditionContext)
    ) {
      applyItemVitals(draft, prepared.effect.values);
    }
  }

  /** Durable-success boundary: only prepared state swaps; cannot load/allocate/call UI hooks. */
  publish(prepared) {
    if (
      this.pending !== prepared ||
      prepared.controller !== this ||
      prepared.released ||
      prepared.published
    ) {
      return;
    }
    if (prepared.reservation) {
      prepared.reservation.authority.publish(prepared.reservation);
    }
    prepared.published = true;
    this.pending = null;
  }

  release(prepared) {
    if (!prepared || prepared.controller !== this || prepared.published) return;
    prepared.released = true;
    if (prepared.reservation) {
      prepared.reservation.authority.abort(prepared.reservation);
    }
    if (this.pending === prepared) this.pending = null;
    if (prepared.effect.state) {
      this.owner.view?.releaseSource?.("item", prepared.effect.state.id);
    }
  }

  /** Cosmic card probability multiplier; used by the real generated DropSystem rows. */
  cardRate(itemId) {
    return this.destroyed ? 1 : this.owner.skills.effects.cardRate(itemId);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.release(this.pending);
  }
}
