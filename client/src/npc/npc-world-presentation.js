import { EntityAnimation } from "../rendering/animation.js";
import { SpeechBubbles } from "../rendering/speech-bubbles.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { check } from "../rendering/stream-network.js";

const MARKER_ACTIONS = ["0", "1", "2"];
const MAX_UTTERANCES = 4096;
const DESTROY = Object.freeze({ children: true });

/** Native ready > available > in-progress precedence; eligibility has one owner. */
function markerState(entries) {
  let state = -1;
  for (const entry of entries) {
    if (entry.state === 1 && entry.ready) return 2;
    if (entry.state === 0) state = 0;
    else if (state < 0 && entry.state === 1) state = 1;
  }
  return state;
}

/** A map-scoped original-art consumer, not another NPC/quest authority. */
export class NpcWorldPresentation {
  constructor(life, quests, options) {
    this.life = life;
    this.scene = life.scene;
    this.quests = quests;
    this.options = options;
    this.slots = [];
    this.destroyed = false;
    this.ready = false;
    this.utterances = 0;
    this.refreshBound = this.refreshQuests.bind(this);
    this.unsubscribe = quests.store.subscribe(this.refreshBound);
    life.world = this;
  }

  async prepare(catalog, signal) {
    const record = catalog.ui.npcWorld;
    if (!record?.markers || !record.speech) {
      throw new Error("Original NPC world presentation catalog is missing");
    }
    try {
      this.markers = await loadVisualBundle(
        record.markers,
        this.options.services,
        signal,
      );
      this.skin = await loadVisualBundle(
        record.speech.bundle,
        this.options.services,
        signal,
      );
      check(signal);
      if (this.destroyed) {
        throw new Error("NPC field was destroyed during preparation");
      }
      for (const slot of this.life.slots) {
        if (slot.record.kind === "npc") this.createSlot(slot, record.speech);
      }
      this.ready = true;
      this.refreshQuests();
      this.refresh();
      return this;
    } catch (error) {
      this.destroy();
      // A late async result can arrive after idempotent field teardown.
      this.markers?.destroy();
      this.skin?.destroy();
      throw error;
    }
  }

  createSlot(life, skin) {
    const marker = new EntityAnimation(
      this.markers.manifest.entities[0],
      this.markers.textures,
    );
    marker.container.eventMode = "none";
    const slot = {
      life,
      marker,
      state: -1,
      speech: null,
      lines: [],
      actions: [],
      cooldownMs:
        this.options.ambient === false || this.options.ambient === "server"
          ? 0
          : (this.randomUint() % 6000) + 3000,
      speechStartTick: null,
      actionMs: 0,
      speechTickMs: 0,
      pose: { x: 0, headY: 0 },
      entity: null,
    };
    this.slots.push(slot);
    life.worldPresentation = slot;
    const authored = life.template.speech;
    if (
      !authored ||
      life.template.info.imitate ||
      this.options.ambient === false
    ) {
      return;
    }
    slot.actions = authored.actions.map((action) => ({ ...action, lines: [] }));
    const hasSpeech =
      authored.lines.length ||
      authored.actions.some((action) => action.lines.length);
    if (hasSpeech) {
      slot.speech = new SpeechBubbles(this.options.app, this.options.services);
      slot.speech.setScene(this.scene);
      slot.speech.prepareNpc(this.skin, skin);
      slot.lines = this.prepareLines(slot.speech, authored.lines);
      for (let index = 0; index < authored.actions.length; index++) {
        slot.actions[index].lines = this.prepareLines(
          slot.speech,
          authored.actions[index].lines,
        );
      }
    }
  }

  prepareLines(speech, lines) {
    this.utterances += lines.length;
    if (this.utterances > MAX_UTTERANCES) {
      throw new Error("NPC utterance budget exceeded");
    }
    return lines.map((line) =>
      line.text ? speech.prepareUtterance(line.text) : null,
    );
  }

  randomUint() {
    const value = this.options.random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error("NPC random source must produce a unit interval value");
    }
    return Math.floor(value * 4294967296);
  }

  /** Save notifications invalidate eligibility; ticks never enumerate quest records. */
  refreshQuests() {
    if (!this.ready || this.destroyed) return;
    for (const slot of this.slots) {
      slot.state = slot.life.template.info.imitate
        ? -1
        : markerState(
            this.quests.npcEntries(Number(slot.life.template.originalId)),
          );
      if (slot.state >= 0) {
        slot.marker.setAction(MARKER_ACTIONS[slot.state]);
        if (slot.speech) {
          slot.speech.remainingMs = -1;
          slot.speech.root.visible = false;
        }
      }
      slot.marker.container.visible =
        slot.state >= 0 &&
        slot.life.resident &&
        !slot.life.record.authored.hide;
    }
  }

  /** Region rebinding changes independent world layers without borrowing actor children. */
  refresh() {
    if (!this.ready || this.destroyed) return;
    for (const slot of this.slots) {
      const entity = slot.life.entity;
      if (slot.entity === entity) continue;
      slot.entity = entity;
      if (entity && !entity.container.destroyed) {
        // Quest markers retain their attached actor depth; speech owns a native field layer.
        this.scene.addWorldContainer(
          slot.marker.container,
          entity.container.zIndex + 3,
        );
      }
    }
    this.update(0);
  }

  update(ms) {
    if (!this.ready || this.destroyed) return;
    for (const slot of this.slots) this.updateSlot(slot, ms);
  }

  updateSlot(slot, ms) {
    const life = slot.life;
    const entity = life.entity;
    const visible = npcVisible(life);
    slot.marker.container.visible = visible && slot.state >= 0;
    if (slot.speech) slot.speech.root.visible = false;
    if (!visible) return;
    slot.speechTickMs = ms;
    if (this.options.ambient === "server") this.observeAmbient(slot);
    else if (this.options.ambient !== false) this.advanceAmbient(slot, ms);
    const first = life.template.actions[entity.action]?.frames[0];
    if (!first) return;
    slot.pose.x = entity.container.x;
    slot.pose.headY = entity.container.y - first.height;
    slot.marker.setPosition(slot.pose.x + 20, slot.pose.headY - 15);
    if (slot.state >= 0) slot.marker.advance(ms);
    if (slot.speech && slot.state < 0) {
      slot.speech.update(slot.speechTickMs, slot.pose, this.scene.camera);
    }
  }

  /** Replay the server's authored line selection; region rebinds never restart it.
   * Original quest-marker precedence remains per character, from published quest state. */
  observeAmbient(slot) {
    if (!slot.speech) return;
    const speech = this.options.speech(slot.life.record.id);
    if (!speech) {
      slot.speech.remainingMs = -1;
      slot.speechStartTick = null;
      return;
    }
    if (slot.speechStartTick === speech.startTick) return;
    const lines =
      speech.actionIndex === null
        ? slot.lines
        : slot.actions[speech.actionIndex]?.lines;
    const prepared = lines?.[speech.lineIndex];
    if (!prepared) {
      throw new Error("Server selected an unknown original NPC utterance");
    }
    slot.speechStartTick = speech.startTick;
    if (slot.state >= 0) return;
    slot.speech.showPrepared(prepared);
    slot.speechTickMs =
      Math.max(0, this.options.tick() - speech.startTick) * 30;
  }

  /** 006d2918 counts30-ms updates; caller supplies the field's existing simulated delta. */
  advanceAmbient(slot, ms) {
    slot.cooldownMs -= ms;
    if (slot.actionMs > 0) {
      slot.actionMs -= ms;
      if (slot.actionMs <= 0) {
        this.changeAction(slot, slot.life.template.defaultAction);
      }
      return;
    }
    if (slot.cooldownMs > 0 || this.options.isTalking?.(slot.life.record.id)) {
      return;
    }
    slot.cooldownMs = (this.randomUint() % 6000) + 3000;
    const count = slot.actions.length + slot.lines.length;
    if (!count) return;
    const choice = (this.randomUint() % 50) % count;
    if (choice >= slot.actions.length) {
      this.speak(slot, slot.lines[choice - slot.actions.length]);
      return;
    }
    const action = slot.actions[choice];
    this.changeAction(slot, action.action);
    slot.actionMs = action.durationMs;
    if (action.lines.length) {
      this.speak(
        slot,
        action.lines[(this.randomUint() % 50) % action.lines.length],
      );
    }
  }

  changeAction(slot, action) {
    slot.life.action = action;
    slot.life.elapsedMs = 0;
    slot.life.entity.setAction(action);
  }

  speak(slot, prepared) {
    // Native006d271f refuses a bubble while an eligible quest-indicator layer exists.
    if (prepared && slot.state < 0) {
      slot.speech.showPrepared(prepared);
      slot.speechTickMs = 0;
    }
  }

  /** Original pool picker also admits the visible marker's actual current frame rectangle. */
  contains(life, x, y) {
    const slot = life.worldPresentation;
    if (!slot?.marker.container.visible) return false;
    const marker = slot.marker;
    const geometry = marker.actions.get(marker.action).geometry[marker.frame];
    return (
      x >= marker.container.x + geometry.x &&
      x < marker.container.x + geometry.x + geometry.width &&
      y >= marker.container.y + geometry.y &&
      y < marker.container.y + geometry.y + geometry.height
    );
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    for (const slot of this.slots) {
      this.scene.removeWorldContainer(slot.marker.container);
      slot.marker.container.destroy(DESTROY);
      if (slot.speech) {
        slot.speech.destroy();
      }
      slot.life.worldPresentation = null;
    }
    this.slots.length = 0;
    this.markers?.destroy();
    this.skin?.destroy();
    if (this.life.world === this) this.life.world = null;
  }
}

function npcVisible(life) {
  const entity = life.entity;
  return Boolean(
    entity &&
    !entity.container.destroyed &&
    life.resident &&
    entity.container.visible &&
    !life.record.authored.hide,
  );
}
