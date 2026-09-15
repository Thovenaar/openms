/** Delayed copies of the same action cannot rewind a remote player's animation. */
export class RemoteAnimationClock {
  constructor() {
    this.phase = 0;
  }
  observe(entity) {
    const phase = entity.combatState?.phaseMs ?? 0;
    const same =
      this.action === entity.action && this.tick === entity.actionStartTick;
    this.phase = same ? Math.max(this.phase, phase) : phase;
    this.action = entity.action;
    this.tick = entity.actionStartTick;
  }
  advance(ms) {
    this.phase += ms;
  }
}
