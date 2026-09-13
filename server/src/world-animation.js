import {
  compileAction,
  loopTime,
  timedFrame,
} from "../../client/src/rendering/animation-timing.js";

/** Renderer-free authored frame observer for the original reactor collision controller. */
export class WorldAnimation {
  constructor(entity, textures) {
    this.container = { visible: entity.visible };
    this.actions = new Map();
    const entries = Object.entries(entity.actions);
    if (entries.length > 65536)
      {throw new Error("Authored action bound exceeded");}
    for (const [name, frames] of entries) {
      if (!frames.length || frames.length > 1024)
        {throw new Error("Authored frame bound exceeded");}
      this.actions.set(name, compileAction(frames, textures));
    }
    this.action = null;
    this.setAction(entity.action);
  }
  setAction(name, playback = "loop") {
    if (name === this.action && playback === this.playback) return;
    const current = this.actions.get(name);
    if (!current) throw new Error("Authored reactor action unavailable");
    this.current = current;
    this.action = name;
    this.playback = playback;
    this.seek(0);
  }
  seek(ms) {
    this.elapsedMs = ms;
    const time =
      this.playback === "once"
        ? Math.min(ms, this.current.duration)
        : loopTime(this.current, ms);
    this.frame = timedFrame(this.current, time);
  }
  advance(ms) {
    this.seek(this.elapsedMs + ms);
  }
}
