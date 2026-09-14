import { combatSoundVolume } from "../audio/audiovisual-system.js";
import { EXPRESSION_NAMES } from "../input/character-bindings.js";
import { unsupported } from "./native-source.js";

/** Existing key bindings and inventory consumers submit intent; only observed state changes display. */
export class NativeWorldActions {
  constructor(owner) {
    this.owner = owner;
    this.destroyed = false;
  }
  emote(index) {
    if (!Number.isInteger(index) || !EXPRESSION_NAMES[index]) {
      return Promise.resolve(unsupported("this expression"));
    }
    return this.owner.request({ kind: "expression.use", expression: index });
  }
  useCashExpression(templateId) {
    return this.owner.request({ kind: "expression.cash", templateId });
  }
  sit() {
    return this.owner.request({ kind: "seat.toggle" });
  }
  activateBinding(name) {
    if (this.destroyed) return null;
    let promise;
    if (name === "Sit") promise = this.sit();
    else if (name.startsWith("Expression:")) {
      promise = this.emote(EXPRESSION_NAMES.indexOf(name.slice(11)));
    } else return null;
    promise.catch((error) => this.owner.report(error));
    return true;
  }
  async offer(request) {
    if (this.destroyed || request.actorId !== this.owner.store.id) {
      return {
        accepted: false,
        ...unsupported("a foreign or retired reactor offer"),
      };
    }
    const outcome = await this.owner.request({
      kind: "reactor.offer",
      itemId: request.uid,
    });
    const value = outcome.receipt?.value;
    if (!outcome.ok) return { ...outcome, accepted: false };
    if (value?.kind !== "world.reactor-offer") {
      throw new Error("Server reactor offer outcome missing");
    }
    return {
      ...outcome,
      accepted: value.accepted,
      consumed: value.consumed,
      reason: "The server accepted the reactor offering.",
    };
  }
  async event(message) {
    const event = message.event;
    if (this.destroyed || !event) return false;
    switch (event.kind) {
      case "world.teleport":
        this.teleport(event);
        return true;
      case "world.portal":
        if (event.actorId === this.owner.store.id) {
          await this.owner.audio.playSound("Game", "Portal");
        }
        return true;
      case "world.tutorial":
        this.owner.hooks.scene()?.native?.showTutorial(event.path);
        return true;
      case "equipment.enhancement":
        await this.owner.audio.playSound(
          "Game",
          event.outcome === "success" ? "EnchantSuccess" : "EnchantFailure",
        );
        return true;
      case "world.reactor":
        await this.reactor(event);
        return true;
      default:
        return false;
    }
  }
  teleport(event) {
    this.owner.hooks
      .scene()
      ?.native?.showTeleport(event.source, event.destination);
    this.owner.hooks.scene()?.relocateObserved?.(event);
  }
  async reactor(event) {
    const scene = this.owner.scene;
    const placement = scene.manifest.reactors.placements.find(
      (entry) => entry.id === event.placementId,
    );
    const descriptor =
      scene.manifest.reactors.templates[placement?.templateId]?.sounds?.[
        event.fromState
      ];
    if (descriptor) {
      await this.owner.audio.audio.playSound(
        descriptor,
        this.owner.hooks.scene().controller.signal,
        combatSoundVolume(placement, scene.simulation),
      );
    }
  }
  destroy() {
    this.destroyed = true;
  }
}

/** Resume the face's independent authored clock; entity changes do not restart it. */
export function observeWorldCharacter(view, entity, serverNow) {
  const expression = entity.expression;
  const animation = view.animation;
  if (expression && expression.expiresAt > serverNow) {
    if (
      view.expressionStartedAt === expression.startedAt &&
      view.expressionName === expression.name
    ) {
      return;
    }
    animation.setExpression(
      expression.name,
      expression.expiresAt - expression.startedAt,
    );
    animation.advanceExpression(Math.max(0, serverNow - expression.startedAt));
    view.expressionStartedAt = expression.startedAt;
    view.expressionName = expression.name;
  } else if (
    view.expressionStartedAt !== null &&
    view.expressionStartedAt !== undefined
  ) {
    animation.setExpression("default", 0);
    view.expressionStartedAt = null;
    view.expressionName = null;
  }
}
