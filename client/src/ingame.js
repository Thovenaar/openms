import { GameUI } from "./game-ui.js";
import { PortalSystem } from "./portal-system.js";
import { LifeSystem } from "./life-system.js";
import { AudiovisualSystem } from "./audiovisual-system.js";

/** Candidate worlds own their field systems independently until atomic commit. */
class FieldSystems {
  constructor(scene, hooks) {
    this.portals = new PortalSystem(scene, hooks);
    try {
      this.life = new LifeSystem(scene, hooks);
    } catch (error) {
      this.portals.destroy();
      throw error;
    }
  }

  refresh() {
    this.life.refresh();
  }

  beforePhysics(input) {
    this.portals.handleInput(input);
  }

  update(ms, input) {
    this.portals.update(ms, input);
    this.life.update(ms);
  }

  snapshot() {
    return { portals: this.portals.snapshot(), life: this.life.snapshot() };
  }

  destroy() {
    this.portals.destroy();
    this.life.destroy();
  }
}

/** Screen-space UI/audio survive map replacement; field systems belong to each scene. */
export class InGameSystems {
  constructor(app, services, hooks) {
    this.audio = new AudiovisualSystem(app, services, {
      onError: hooks.onError,
    });
    this.playSound = this.playSound.bind(this);
    this.ui = new GameUI(app, services, {
      clearInput: hooks.clearInput,
      focusGame: hooks.focusGame,
      onError: hooks.onError,
      playSound: this.playSound,
    });
    this.fieldHooks = {
      travel: hooks.travel,
      onError: hooks.onError,
      playSound: this.playSound,
      onInteract: this.ui.showNpc.bind(this.ui),
    };
  }

  playSound(category, name) {
    return this.audio.playSound(category, name).catch(this.audio.reportBound);
  }

  async prepare(catalog, signal) {
    await this.audio.prepare(catalog.audiovisual, signal);
    await this.ui.prepare(catalog.ui, signal);
  }

  prepareScene(scene) {
    scene.fieldSystems = new FieldSystems(scene, this.fieldHooks);
  }

  setScene(scene) {
    this.ui.setScene(scene);
    this.audio.setScene(scene);
  }

  updateInterface(ms) {
    this.ui.update(ms);
    this.audio.update(ms);
  }

  resize(width, height) {
    this.ui.resize(width, height);
  }

  snapshot() {
    return { ui: this.ui.snapshot(), audiovisual: this.audio.snapshot() };
  }

  destroy() {
    this.ui.destroy();
    this.audio.destroy();
  }
}
