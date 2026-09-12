// Original executable evidence: docs/ghidra-client-corrections/native-aran-*.txt.
// 0074b03d..0074b382 builds down/up/down/up then the Triple child.
// 0074d993 rejects duplicate key states; 0074de09 drains after action completion.
const MAX_INPUT_EVENTS = 15; // Browser packet bound, not an original gameplay limit.
const DOUBLE = 21000002;
const TRIPLE = 21100001;
const QUEUE_LIFETIME_MS = 1000; // Vtable+18 ->0074c66e; expiry is inclusive.
//0074d993 cumulative recognizer deadlines, including the inherited Triple child.
const RECOGNITION_DEADLINES = Object.freeze([0, 480, 480, 900, 1320]);

function validatePacket(events, count) {
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > MAX_INPUT_EVENTS ||
    !Number.isSafeInteger(events) ||
    events < 0 ||
    events >= 4 ** count
  ) {
    throw new Error("Invalid ordered attack input packet");
  }
}

/** Append ordered physical transitions without allocating in event/tick paths. */
export function appendAttackEvent(input, event) {
  if (input.attackEventCount >= MAX_INPUT_EVENTS) {
    throw new RangeError("Attack input packet capacity exceeded");
  }
  input.attackEvents += event * 4 ** input.attackEventCount;
  input.attackEventCount++;
}

function ordinaryPolearm(field) {
  return (
    field.phase === "attack" &&
    !field.attackSkill &&
    (field.attackName === "swingT2PoleArm" ||
      field.attackName === "swingP1PoleArm" ||
      field.attackName === "swingP2PoleArm")
  );
}

function doubleSwing(field) {
  const id = field.attackSkill?.id;
  return (
    field.phase === "attack" &&
    (id === DOUBLE || id === 20000014 || id === 21110007 || id === 21120009)
  );
}

/** Owns only recognition and the two possible buffered follow-ups, never costs/damage. */
export class AranInput {
  constructor(field) {
    this.field = field;
    this.clock = 0;
    this.started = 0;
    this.stage = 0;
    this.held = false;
    this.first = 0;
    this.second = 0;
    this.firstExpiry = 0;
    this.secondExpiry = 0;
  }

  clear() {
    this.stage = 0;
    this.held = false;
    this.first = this.second = 0;
  }

  enabled() {
    const field = this.field,
      job = field.store.profile.job;
    return (
      !field.dead &&
      !field.simulation.seat &&
      (job === 2000 || Math.trunc(job / 100) === 21) &&
      field.combat?.weaponType === 44
    );
  }

  /** Input packet is immutable here: the physical owner clears it after the tick. */
  input(ms, input) {
    this.clock += ms;
    if (!this.enabled()) {
      this.clear();
      return;
    }
    let events = input.attackEvents ?? 0;
    const count = input.attackEventCount ?? 0;
    validatePacket(events, count);
    for (let index = 0; index < count; index++) {
      const event = events % 4;
      events = Math.trunc(events / 4);
      if (event === 3) this.clear();
      else if (event === 0) this.stage = 0;
      else this.attackEdge(event === 1);
    }
  }

  attackEdge(down) {
    if (down === this.held) return;
    this.edge(down);
    if (down && !this.first && this.field.phase === "idle") {
      this.field.beginAttack();
    }
  }

  edge(down) {
    if (down === this.held) return;
    this.held = down;
    const elapsed = this.clock - this.started;
    // Recognition deadlines are cumulative, not attack-speed-adjusted windows.
    // Child allowance at0074db8b is900+420=1320, before its first660 stage.
    if (this.stage && elapsed > RECOGNITION_DEADLINES[this.stage]) {
      this.stage = 0;
    }
    this.recognizeStage(down);
  }

  /** Advance only the ordered down/up recognizer; queue admission stays separate. */
  recognizeStage(down) {
    if (this.stage === 0) {
      if (down) {
        this.started = this.clock;
        this.stage = 1;
      }
      return;
    }
    if (this.stage === 1 && !down) {
      this.stage = 2;
      return;
    }
    if (this.stage === 2 && down) {
      this.queueDouble();
      this.stage = 3;
      return;
    }
    if (this.stage === 3 && !down) {
      this.stage = 4;
      return;
    }
    if (this.stage === 4 && down) {
      this.queueTriple();
      this.stage = 0;
    }
  }

  baseId(id) {
    if (this.field.store.profile.job !== 2000) return id;
    return id === DOUBLE ? 20000014 : 20000015;
  }

  queueDouble() {
    const field = this.field,
      id = this.baseId(DOUBLE);
    if (
      !ordinaryPolearm(field) ||
      !field.hooks.skillLevel?.(id) ||
      this.first
    ) {
      return;
    }
    this.first = id;
    this.firstExpiry = this.clock + QUEUE_LIFETIME_MS;
  }

  queueTriple() {
    const field = this.field,
      id = this.baseId(TRIPLE);
    if (!field.hooks.skillLevel?.(id)) return;
    //0074dd71 accepts Triple behind Double, never behind another Triple.
    if (this.first === this.baseId(DOUBLE) && !this.second) {
      this.second = id;
      this.secondExpiry = this.clock + QUEUE_LIFETIME_MS;
    } else if (!this.first && doubleSwing(field)) {
      this.first = id;
      this.firstExpiry = this.clock + QUEUE_LIFETIME_MS;
    }
  }

  /** Returns true only when atomic skill admission starts a real authored action. */
  advance() {
    if (this.field.phase !== "idle") return false;
    for (let index = 0; index < 2 && this.first; index++) {
      if (this.clock >= this.firstExpiry) {
        this.shift();
        continue;
      }
      const id = this.field.hooks.resolveSkillId?.(this.first) ?? this.first;
      const result = this.field.hooks.activateSkill?.(id);
      if (!result?.ok) return false;
      this.shift();
      return true;
    }
    return false;
  }

  shift() {
    this.first = this.second;
    this.firstExpiry = this.secondExpiry;
    this.second = 0;
  }
}
