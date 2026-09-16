import { PhysicalDamage } from "../combat/physical-damage.js";
import { overlaps, rectangleState } from "../combat/offline-mobs.js";
import { placeBody } from "../world/life-geometry-numeric.js";
import { actionWeapon, attackRectangle } from "../skills/skill-attack.js";
import { skillLineCount } from "../skills/skill-damage.js";
import { skillNumber } from "../skills/skill-costs.js";
import { animationName } from "../../../shared/motion-schema.js";
import { previewTarget } from "./local-projectile-rules.js";

const MAX_TARGETS = 30;
const MAX_LINES = 30;
const MAX_PENDING = 128;
const PREDICTION_TTL_MS = 4000;
const REACTION_ACTION = "hit1";
const BASIC_INFO = Object.freeze({ damage: 100 });
/** 009537d5/0092fb41 flight speed used by the local projectile preview. */
const FLIGHT_SCALE = 1.5;
const FLIGHT_SHOULDER = 28;
const FLIGHT_HIT_Y = 20;

/** The original client resolves its own attack feedback locally and lets the server arbitrate
 *  the durable outcome (`009581a9` damage, `0066b05e` popup, `0095931c` attack display).
 *  This owner does the same: the attacker sees the reaction and the number at its own release
 *  frame, while HP, death, drops and knockback still follow the authoritative event. */
export class LocalHits {
  constructor(combat, now = () => performance.now(), random = Math.random) {
    this.combat = combat;
    this.now = now;
    this.damage = new PhysicalDamage(random);
    this.attackBody = rectangleState();
    this.receiver = rectangleState();
    this.targets = new Array(MAX_TARGETS).fill(null);
    // One FIFO per target: each authoritative event consumes exactly one local prediction.
    this.pending = new Map();
    this.reactions = new Map();
    this.timers = new Set();
  }

  /** Schedule the release-frame feedback for one locally admitted action. */
  begin(record) {
    if (record.rejected || record.hitScheduled) return;
    const rectangle = attackRectangle(
      record.info ?? BASIC_INFO,
      actionWeapon(this.avatarCombat(), record.action),
    );
    const spec = record.spec;
    // Charge releases carry a charge-scaled circle the browser cannot reproduce.
    if (spec?.kind === "charge") return;
    const ray = Boolean(record.projectile);
    if (!ray && !rectangle) return;
    record.hitScheduled = true;
    record.hits = this;
    record.hitRectangle = rectangle ?? null;
    record.hitRay = ray;
    record.hitTimer = this.schedule(record, record.release, () =>
      this.resolve(record),
    );
  }

  avatarCombat() {
    return this.stage?.actor?.avatar?.combat ?? null;
  }

  /** The online scene owns the entity views; its stream scene owns the local actor pose. */
  get stage() {
    return this.combat.scene?.scene ?? null;
  }

  schedule(record, delay, run) {
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        if (!record.rejected) run();
      },
      Math.max(0, Number(delay) || 0),
    );
    this.timers.add(timer);
    return timer;
  }

  /** Resolve one attack against the mob poses the player is actually seeing. */
  resolve(record) {
    record.hitTimer = null;
    if (record.rejected || !record.hits) return;
    const scene = this.combat.scene;
    const origin = this.stage?.presentation;
    const stats = this.combat.owner.hooks.characterStats?.();
    if (!scene || !origin || !stats) return;
    const count = this.select(record, origin);
    for (let index = 0; index < count; index++) {
      const view = this.targets[index];
      this.targets[index] = null;
      // 00953fca: the number and the reaction wait for the ball, not for the release frame.
      const delay = record.hitRay ? flightMs(origin, view) : 0;
      this.roll(record, view, stats, delay);
    }
  }

  select(record, origin) {
    const scene = this.combat.scene;
    if (record.hitRay) {
      const view = previewTarget(scene, origin, record.projectile?.range ?? 0);
      if (view && this.eligible(view)) {
        this.targets[0] = view;
        return 1;
      }
      return 0;
    }
    placeBody(this.attackBody, record.hitRectangle, origin, origin.facing > 0);
    const limit = Math.min(
      MAX_TARGETS,
      Math.max(1, skillNumber(record.info?.mobCount, 1)),
    );
    const found = [];
    for (const view of scene.views.values()) {
      if (!this.eligible(view)) continue;
      const body = this.mobBody(view, this.receiver);
      if (!body || !overlaps(this.attackBody, body)) continue;
      found.push(view);
    }
    found.sort(
      (left, right) =>
        Math.abs(left.drawX - origin.x) - Math.abs(right.drawX - origin.x),
    );
    const count = Math.min(limit, found.length);
    for (let index = 0; index < count; index++) {
      this.targets[index] = found[index];
    }
    return count;
  }

  eligible(view) {
    const entity = view.entity;
    if (entity.kind !== "mob" || !entity.mobState?.hp) return false;
    if (entity.mobState.phase === "spawning") return false;
    return !view.life?.info?.invincible;
  }

  /** The authored receiver of the frame the mob is drawn with, at its drawn position. */
  mobBody(view, slot) {
    const action =
      view.life?.actions?.[view.animation.action] ??
      view.life?.actions?.[animationName(view.entity.action)];
    const frames = action?.frames;
    if (!frames?.length) return null;
    const index = Math.max(
      0,
      Math.min(view.animation.frame, frames.length - 1),
    );
    const body = frames[index].body;
    if (!body) return null;
    placeBody(
      slot,
      body,
      { x: view.drawX, y: view.drawY },
      view.entity.facing > 0,
    );
    return slot;
  }

  roll(record, view, stats, delay) {
    const info = view.life?.info;
    if (!info) return;
    const lines = this.lines(record);
    const rolls = [];
    for (let line = 0; line < lines; line++) {
      let amount;
      try {
        amount = this.damage.generate(
          stats,
          info,
          this.percent(record),
          record.use,
        );
      } catch {
        return;
      }
      if (!Number.isSafeInteger(amount) || amount < 0) return;
      rolls.push({ amount, critical: this.damage.lastCritical });
    }
    this.remember(view, rolls[0].amount, delay);
    if (delay > 0) {
      this.schedule(record, delay, () => this.present(record, view, rolls));
      return;
    }
    this.present(record, view, rolls);
  }

  lines(record) {
    if (!record.skillId) return 1;
    return Math.max(
      1,
      Math.min(MAX_LINES, skillLineCount(record.info ?? BASIC_INFO)),
    );
  }

  percent(record) {
    const percent = Number(record.info?.damage);
    return Number.isSafeInteger(percent) && percent > 0 ? percent : 100;
  }

  remember(view, amount, delay) {
    this.prune();
    const id = view.entity.id;
    let queue = this.pending.get(id);
    if (!queue) {
      queue = [];
      this.pending.set(id, queue);
    }
    if (queue.length >= MAX_PENDING) queue.shift();
    queue.push({ at: this.now() + delay, damage: amount });
  }

  /** Reserve one display slot, or give up instead of throwing out of a timer callback. */
  reserve() {
    const numbers = this.combat.scene?.events?.combat?.snapshot?.();
    if (
      numbers &&
      numbers.active + numbers.pending + 1 > numbers.hardCapacity
    ) {
      return false;
    }
    this.combat.scene.events.reserveNumber();
    return true;
  }

  /** Draw the local number and start the local hit reaction. */
  present(record, view, rolls) {
    if (record.rejected) return;
    const scene = this.combat.scene;
    if (!scene?.views.has(view.entity.id)) return;
    const target = scene.events.target(view);
    if (record.skillId) {
      for (let line = 0; line < rolls.length; line++) {
        if (!this.reserve()) return;
        scene.events.combat.onSkillDamageLine(target, rolls[line].amount, {
          line,
          critical: rolls[line].critical,
          skillId: record.skillId,
        });
      }
    } else {
      if (!this.reserve()) return;
      scene.events.combat.onMobHit(target, rolls[0].amount, rolls[0].critical);
    }
    this.react(view, rolls[0].amount);
  }

  /** `0066b98b`: the hit pose persists for its authored duration and only then yields. */
  react(view, amount) {
    const info = view.life?.info;
    if (!info || amount < (info.pushed ?? 1)) return;
    if (view.entity.mobState?.phase === "attack") return;
    const action = view.animation.actions.get(REACTION_ACTION);
    if (!action) return;
    const observed = animationName(view.entity.action);
    // A mob already inside its own hit window keeps the reaction it has.
    if (observed === REACTION_ACTION) return;
    this.reactions.set(view.entity.id, {
      until: this.now() + Math.max(1, action.duration),
      observed,
    });
  }

  /** The pose the mob should present, or null while the observed action still owns it. */
  reaction(view) {
    const entry = this.reactions.get(view.entity.id);
    if (!entry) return null;
    // Any change in the observed action (the confirmed hit, a death, a fresh attack) means
    // authority has something newer to present, so the local pose yields at once.
    if (
      this.now() >= entry.until ||
      animationName(view.entity.action) !== entry.observed
    ) {
      this.reactions.delete(view.entity.id);
      return null;
    }
    return view.animation.actions.has(REACTION_ACTION) ? REACTION_ACTION : null;
  }

  /** True when one local prediction already presented this authoritative event. */
  consume(event) {
    if (event.actorId !== this.combat.scene?.selfId) return false;
    const queue = this.pending.get(event.targetId);
    if (!queue?.length) return false;
    // A rejected or missed authoritative outcome is still shown, so the correction is visible.
    if (event.damage <= 0) return false;
    const prediction = queue.shift();
    if (!queue.length) this.pending.delete(event.targetId);
    return this.now() - prediction.at <= PREDICTION_TTL_MS;
  }

  prune() {
    const now = this.now();
    for (const [targetId, queue] of this.pending) {
      while (queue.length && now - queue[0].at > PREDICTION_TTL_MS) {
        queue.shift();
      }
      if (!queue.length) this.pending.delete(targetId);
    }
  }

  cancel(record) {
    record.hits = null;
    if (!record.hitTimer) return;
    clearTimeout(record.hitTimer);
    this.timers.delete(record.hitTimer);
    record.hitTimer = null;
  }

  destroy() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.reactions.clear();
  }
}

function flightMs(origin, view) {
  const dx = view.drawX - origin.x;
  const dy = view.drawY - FLIGHT_HIT_Y - (origin.y - FLIGHT_SHOULDER);
  return Math.max(1, Math.trunc(Math.hypot(dx, dy) * FLIGHT_SCALE));
}
