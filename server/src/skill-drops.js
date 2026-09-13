import { randomUUID } from "node:crypto";
import { MAX_MESO_PILES } from "../../client/src/skills/skill-target-rules.js";
import {
  DROP_POLICY,
  explosionEligible,
  selectExplosionDrops,
} from "../../client/src/world/drop-rules.js";
import {
  MAX_FIELD_DROPS,
  prepareFieldDrop,
  publishFieldDrop,
} from "./field-drops.js";
import { reject } from "./action-rules.js";

function newPlan(adapter, kind) {
  return {
    id: randomUUID(),
    adapter,
    kind,
    field: adapter.actor.field,
    actorId: adapter.actor.id,
    state: "reserved",
    requests: [],
    grantEntitlements: [],
    consumeEntitlements: [],
    reserved: 0,
  };
}

/** Original skill controller adapter; proposals never credit, consume, or publish ground state. */
export class AuthoritySkillDrops {
  constructor(world, actor) {
    this.world = world;
    this.actor = actor;
    this.selection = null;
    this.selectionCount = 0;
    this.rectangle = { left: 0, right: 0, top: 0, bottom: 0 };
    this.explosionPlan = null;
    this.pickpocketPlan = null;
  }

  selectExplosion(rectangle, output, limit) {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_MESO_PILES ||
      output.length < limit
    ) {
      reject(
        "CONTENT_MISMATCH",
        "Meso Explosion selection exceeds the original pile bound.",
      );
    }
    if (this.explosionPlan) return 0;
    this.rectangle.left = rectangle.left;
    this.rectangle.right = rectangle.right;
    this.rectangle.top = rectangle.top;
    this.rectangle.bottom = rectangle.bottom;
    this.selection = output;
    this.selectionCount = selectExplosionDrops(
      this.actor.field.drops.values(),
      rectangle,
      output,
      limit,
    );
    return this.selectionCount;
  }

  /** Called only by the admitted per-hit shared Pickpocket algorithm; never an online action. */
  spawnPickpocket(mob, amount) {
    const field = this.actor.field;
    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > DROP_POLICY.mesoLimit ||
      field.drops.size + field.dropReservations >= MAX_FIELD_DROPS
    )
      {return false;}
    let drop;
    try {
      drop = prepareFieldDrop(this.world, this.actor, {
        source: mob,
        mesos: amount,
        durableEntitlement: true,
      });
    } catch (error) {
      if (error.code === "REQUIREMENTS_NOT_MET") return false;
      throw error;
    }
    this.pickpocketPlan ??= newPlan(this, "pickpocket");
    this.pickpocketPlan.requests.push(drop);
    this.pickpocketPlan.grantEntitlements.push({ id: drop.id, kind: "drop" });
    this.pickpocketPlan.reserved++;
    field.dropReservations++;
    return true;
  }

  /** One combined grant plan per impact; owner joins it to lethal rewards or its impact transaction. */
  takePickpocketPlan() {
    const plan = this.pickpocketPlan;
    this.pickpocketPlan = null;
    return plan;
  }

  /** Shared cast copies these already-paid sources into damage piles; never performs a second debit. */
  consumeExplosion(selected, count) {
    const plan = this.explosionPlan;
    if (
      !plan ||
      plan.state !== "committed" ||
      count !== plan.requests.length ||
      selected !== this.selection
    ) {
      reject(
        "NOT_ALLOWED",
        "Meso Explosion requires the committed skill/drop reservation.",
      );
    }
    for (let index = 0; index < count; index++) {
      if (selected[index] !== plan.requests[index])
        {reject("NOT_ALLOWED", "Meso Explosion selection changed.");}
    }
    plan.state = "consumed";
  }

  destroy() {
    releaseSkillDrops(this.pickpocketPlan);
    releaseSkillDrops(this.explosionPlan);
    this.pickpocketPlan = null;
    this.explosionPlan = null;
    this.selection = null;
  }
}

/** Selection identity and bounds belong to the original controller, not the request. */
function admittedExplosionSelection(actor, selected, count) {
  const adapter = actor.skillDrops;
  if (
    !adapter ||
    adapter.explosionPlan ||
    selected !== adapter.selection ||
    count !== adapter.selectionCount ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_MESO_PILES
  ) {
    reject(
      "NOT_ALLOWED",
      "Meso Explosion has no current authoritative selection.",
    );
  }
  return adapter;
}

/** Original Meso Explosion destroys loose mesos regardless of pickup ownership (Cosmic damage handler940). */
export function prepareSkillDrops(actor, skill, selected, count) {
  if (skill.id !== 4211006) return null;
  const adapter = admittedExplosionSelection(actor, selected, count);
  const plan = newPlan(adapter, "explosion");
  try {
    for (let index = 0; index < count; index++) {
      const drop = selected[index];
      if (
        actor.field.drops.get(drop.id) !== drop ||
        !drop.durableEntitlement ||
        drop.expiresAt <= adapter.world.now ||
        !explosionEligible(drop, adapter.rectangle)
      ) {
        reject("NOT_ALLOWED", "Meso Explosion source is unavailable.");
      }
      drop.reservation = plan.id;
      plan.requests.push(drop);
      plan.consumeEntitlements.push({ id: drop.id, kind: "drop" });
    }
    adapter.explosionPlan = plan;
    return plan;
  } catch (error) {
    releaseSkillDrops(plan);
    throw error;
  }
}

/** Recheck inside the same skill-cost DB mutator; failed admission consumes no mesos or MP. */
export function admitSkillDrops(actor, plan) {
  if (!plan) return;
  if (
    plan.state !== "reserved" ||
    plan.actorId !== actor.id ||
    plan.field !== actor.field
  ) {
    reject("STALE_FIELD", "The skill drop reservation changed fields.");
  }
  if (plan.kind !== "explosion") return;
  for (const drop of plan.requests) {
    if (
      plan.field.drops.get(drop.id) !== drop ||
      drop.reservation !== plan.id ||
      drop.expiresAt <= plan.adapter.world.now ||
      !explosionEligible(drop, plan.adapter.rectangle, plan.id)
    ) {
      reject(
        "NOT_ALLOWED",
        "Reserved explosion source changed before skill payment.",
      );
    }
  }
}

/** Skill receipt marker fences the single durable cost/entitlement transaction before shared cast. */
export function commitSkillDrops(actor, plan, receipt) {
  if (
    !plan ||
    plan.state !== "reserved" ||
    receipt.status !== "committed" ||
    receipt.value?.dropPlanId !== plan.id
  )
    {return false;}
  if (actor.field !== plan.field || actor.id !== plan.actorId)
    {reject("STALE_FIELD", "Explosion field changed after commitment.");}
  for (const drop of plan.requests) {
    plan.field.drops.delete(drop.id);
    drop.active = false;
  }
  plan.state = "committed";
  plan.adapter.world.broadcast(plan.field, {
    type: "event",
    fieldEpoch: plan.field.epoch,
    event: {
      kind: "drop.explode",
      eventId: plan.id,
      actorId: actor.id,
      dropIds: plan.requests.map((drop) => drop.id),
      impactTick: plan.field.tick,
    },
  });
  return true;
}

export function commitPickpocketDrops(world, actor, plan, receipt) {
  if (
    !plan ||
    plan.state !== "reserved" ||
    receipt.status !== "committed" ||
    receipt.value?.pickpocketPlanId !== plan.id
  )
    {return false;}
  if (actor.field !== plan.field || actor.id !== plan.actorId)
    {reject("STALE_FIELD", "Pickpocket field changed after commitment.");}
  for (const drop of plan.requests)
    {publishFieldDrop(plan.field, drop, world.now);}
  plan.state = "committed";
  return true;
}

/** Always run after settlement/cast; transient reservations never outlive their field authority. */
export function releaseSkillDrops(plan) {
  if (!plan || plan.state === "released") return;
  for (const drop of plan.requests) {
    if (drop.reservation === plan.id) drop.reservation = null;
  }
  plan.field.dropReservations -= plan.reserved;
  plan.reserved = 0;
  if (plan.adapter.explosionPlan === plan) plan.adapter.explosionPlan = null;
  plan.state = "released";
}
