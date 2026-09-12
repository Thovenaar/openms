import { skillNumber } from "./skill-costs.js";
import { overlaps } from "../combat/offline-mobs.js";

/** Original009579c3/0096ce0d queue one follow-up;0067886d caps chain reach at400. */
export class SkillChain {
  constructor(combat) {
    this.combat = combat;
    this.pending = false;
    this.origin = { x: 0, y: 0, facing: 1 };
    this.excluded = null;
    this.travelMs = 0;
    this.sequences = new Uint32Array(128);
    this.selection = { excluded: null, count: 0, range: 0 };
  }

  queue(shot) {
    const combat = this.combat;
    const spec = combat.prepared.get(shot.skill.id)?.spec;
    if (!this.canSpark(shot, spec)) return;
    const sequence = shot.sequence || combat.attackSequence;
    const index = sequence % this.sequences.length;
    if (this.sequences[index] === sequence) return;
    this.sequences[index] = sequence;
    this.excluded = shot.target;
    this.origin.x = shot.target.x;
    this.origin.y = shot.target.y;
    this.origin.facing = shot.facing || combat.field.simulation.facing;
    this.pending = true;
  }

  canSpark(shot, spec) {
    if (
      shot.summon ||
      spec?.magic ||
      spec?.kind === "magic" ||
      spec?.kind === "heal"
    ) {
      return false;
    }
    return (
      shot.skill.id !== 15111006 &&
      !!this.combat.field.hooks.derivedStats?.().spark
    );
  }

  step() {
    if (!this.pending) return;
    this.pending = false;
    const combat = this.combat;
    const record = combat.prepared.get(15111006);
    if (!record || !combat.field.hooks.derivedStats?.().spark) return;
    const count = this.select(record, this.origin, this.excluded);
    const charge = combat.chargeMs;
    combat.chargeMs = -1;
    if (count) combat.generate(record, count, this.origin, "player");
    combat.chargeMs = charge;
  }

  select(record, origin, excluded = null) {
    const combat = this.combat;
    const range =
      record.skill.id === 2221006 ? 150 : skillNumber(record.info.range, 150);
    const limit = Math.min(15, skillNumber(record.info.mobCount, 1));
    const first =
      record.skill.id === 2221006
        ? this.firstLightning(record, origin)
        : this.firstSpark(record, origin, excluded, range);
    if (!first) return 0;
    combat.targets[0] = first;
    let count = 1,
      previous = first;
    const selection = this.selection;
    selection.excluded = excluded;
    selection.range = range;
    while (count < limit) {
      selection.count = count;
      const target = this.next(record, origin, previous, selection);
      if (!target) break;
      combat.targets[count++] = target;
      previous = target;
    }
    return count;
  }

  firstSpark(record, origin, excluded, range) {
    const box = this.combat.body;
    box.left = origin.x + (origin.facing > 0 ? 0 : -range);
    box.right = origin.x + (origin.facing > 0 ? range : 0);
    box.top = origin.y - 150;
    box.bottom = origin.y + 150;
    box.active = true;
    return this.firstEligible(record.skill, excluded);
  }

  /** Original006789ed scans20px slices from50 to300, widening by distance/4. */
  firstLightning(record, origin) {
    const marked = this.combat.homing;
    const priority =
      marked && marked.deaths === this.combat.homingGeneration
        ? this.lightningRay(record, origin, marked)
        : null;
    return priority ?? this.lightningRay(record, origin, null);
  }

  lightningRay(record, origin, priority) {
    const box = this.combat.body;
    for (let distance = 50; distance < 300; distance += 20) {
      const end = Math.min(300, distance + 20);
      box.left = origin.x + (origin.facing > 0 ? distance : -end);
      box.right = origin.x + (origin.facing > 0 ? end : -distance);
      const height = Math.trunc(distance / 4);
      box.top = origin.y - 28 - height;
      box.bottom = origin.y - 28 + height;
      box.active = true;
      const target = this.firstEligible(record.skill, null, priority);
      if (target) return target;
    }
    return null;
  }

  firstEligible(skill, excluded, priority = null) {
    for (const mob of this.combat.field.mobs) {
      if (priority && mob !== priority) continue;
      if (
        mob !== excluded &&
        this.combat.eligible(mob, skill) &&
        overlaps(this.combat.body, mob.body)
      ) {
        return mob;
      }
    }
    return null;
  }

  next(record, origin, previous, selection) {
    const range = selection.range;
    const combat = this.combat,
      box = combat.body;
    const anchor = combat.targets[0];
    box.left =
      origin.facing > 0
        ? previous.x
        : Math.max(previous.x - range, anchor.x - 400);
    box.right =
      origin.facing > 0
        ? Math.min(previous.x + range, anchor.x + 400)
        : previous.x;
    box.top = previous.y - 150;
    box.bottom = previous.y + 150;
    box.active = true;
    let nearest = null,
      distance = Infinity,
      candidates = 0;
    for (const mob of combat.field.mobs) {
      if (!this.candidate(mob, record.skill, previous, selection.excluded)) {
        continue;
      }
      if (candidates++ === 10) break;
      let seen = false;
      for (let index = 0; index < selection.count; index++) {
        if (combat.targets[index] === mob) {
          seen = true;
          break;
        }
      }
      if (seen) continue;
      const squared = (mob.x - previous.x) ** 2 + (mob.y - previous.y) ** 2;
      if (squared < distance) {
        nearest = mob;
        distance = squared;
      }
    }
    return nearest;
  }

  candidate(mob, skill, previous, excluded) {
    return (
      mob !== previous &&
      mob !== excluded &&
      this.combat.eligible(mob, skill) &&
      overlaps(this.combat.body, mob.body)
    );
  }
  /** Native00955f chain impacts are100ms apart; Spark0094289f uses cumulative travel. */
  stage(shot, index, origin) {
    const previous = index ? this.combat.targets[index - 1] : null;
    shot.beam = true;
    shot.chain = shot.skill.id === 2221006;
    shot.endX = Math.trunc(shot.endX);
    shot.endY = Math.trunc(shot.endY);
    shot.startX = previous
      ? Math.trunc((previous.body.left + previous.body.right) / 2)
      : origin.x + origin.facing * 25;
    shot.startY = previous
      ? Math.trunc((previous.body.top + previous.body.bottom) / 2)
      : origin.y - (shot.chain ? 28 : 0);
    shot.x = shot.startX;
    shot.y = shot.startY;
    if (shot.chain) {
      shot.delay = index * 100;
      shot.duration = 270;
    } else {
      if (!index) this.travelMs = 0;
      shot.delay = this.travelMs;
      shot.duration = Math.trunc(
        Math.hypot(shot.endX - shot.startX, shot.endY - shot.startY) * 2,
      );
      this.travelMs += shot.duration;
    }
  }

  clear() {
    this.pending = false;
    this.excluded = null;
    this.sequences.fill(0);
  }
}
