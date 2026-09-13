const MAX_MOBS = 4096;

/** Skill.wz5101007 level.prop is the percent chance the barrel is detected. */
export class SkillBarrel {
  constructor(system) {
    this.system = system;
    this.contacts = new Map();
  }

  prepare() {
    const mobs = this.system.hooks.gameplay().worldSkills().mobs;
    if (mobs.length > MAX_MOBS) {
      throw new Error("Barrel contact bound exceeded");
    }
    this.contacts.clear();
    for (const mob of mobs) {
      this.contacts.set(mob.id, { mob, overlapping: false, concealed: false });
    }
  }

  reset() {
    for (const contact of this.contacts.values()) {
      contact.overlapping = false;
      contact.concealed = false;
    }
  }
  step() {
    const sim = this.system.scene.simulation;
    for (const contact of this.contacts.values()) {
      const body = contact.mob.body;
      const overlap =
        body.active &&
        sim.x >= body.left &&
        sim.x < body.right &&
        sim.y >= body.top &&
        sim.y <= body.bottom;
      if (!overlap) {
        contact.overlapping = false;
        contact.concealed = false;
      }
    }
  }

  intercept(mob, info, outcome = null) {
    const contact = this.contacts.get(mob.id);
    if (!contact) return false;
    if (!contact.overlapping) {
      const concealed =
        (this.system.hooks.random ?? Math.random)() * 100 >= info.prop;
      const apply = () => {
        contact.overlapping = true;
        contact.concealed = concealed;
      };
      if (outcome) outcome.effects.push(apply);
      else apply();
      return concealed;
    }
    return contact.concealed;
  }
}
