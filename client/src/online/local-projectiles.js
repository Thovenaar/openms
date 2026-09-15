import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { previewDestination } from "./local-projectile-rules.js";

const MAX_FLIGHTS = 128;
const DESTROY = Object.freeze({ children: true });

/** Disposable flight previews; confirmed hits still own numbers, HP, knockback and loot. */
export class LocalProjectiles {
  constructor(combat) {
    this.combat = combat;
    this.flights = new Set();
  }
  begin(record) {
    if (!record.projectile) return;
    record.projectileEchoes = new Set();
    record.previewCount = 0;
    record.timer = setTimeout(() => {
      record.timer = null;
      this.launch(record).catch((error) => {
        if (!record.rejected && error.name !== "AbortError") {
          this.combat.owner.report(error);
        }
      });
    }, record.release);
    // Preparation starts on input, before the authored release frame.
    const descriptor = record.projectile.descriptor;
    if (descriptor?.bundle) {
      record.preparation = this.prepare(record, descriptor.bundle);
      record.preparation.catch((error) => {
        record.projectileError = error.message;
      });
    }
  }
  async prepare(record, bundle) {
    const owner = this.combat.owner;
    const warmed = owner.skillVisuals.warmup.get(bundle);
    if (warmed) return warmed;
    const lease = await loadVisualBundle(
      bundle,
      owner.services,
      this.combat.scene.controller.signal,
    );
    if (record.rejected) {
      lease.destroy();
      return null;
    }
    record.projectileLease = lease;
    return lease;
  }
  async launch(record) {
    const lease = record.preparation ? await record.preparation : null;
    if (record.rejected || record.serverProjectile || !this.combat.scene) {
      return;
    }
    const preview = record.projectile;
    const origin = this.combat.scene.scene.presentation;
    const destination = previewDestination(
      this.combat.scene,
      origin,
      preview.range,
    );
    const shot = {
      previewId: record.identity,
      projectileId: preview.templateId,
      facing: origin.facing,
      x: origin.x + origin.facing * preview.start,
      y: origin.y - 28,
      endX: destination.x,
      endY: destination.y,
      target: null,
    };
    shot.duration = Math.max(
      1,
      Math.trunc(Math.hypot(shot.endX - shot.x, shot.endY - shot.y) * 1.5),
    );
    if (lease) this.balls(record, lease, shot);
    else if (
      !this.combat.scene.events.combat.projectileAdmissionError(preview.count)
    ) {
      this.combat.scene.events.combat.onProjectile({
        ...shot,
        info: { bulletCount: preview.count },
      });
      record.previewCount = preview.count;
    }
  }
  balls(record, lease, shot) {
    const count = record.projectile.count;
    if (this.flights.size + count > MAX_FLIGHTS) return;
    for (let index = 0; index < count; index++) {
      const animation = new EntityAnimation(
        lease.manifest.entities[0],
        lease.textures,
      );
      animation.setAction("play", "loop", true);
      animation.container.scale.x = shot.facing > 0 ? -1 : 1;
      animation.setPosition(shot.x, shot.y);
      this.combat.scene.scene.addWorldContainer(animation.container, 398500);
      this.flights.add({
        record,
        animation,
        shot,
        spread: 7 * (2 * index + 1 - count),
        age: 0,
      });
    }
    record.previewCount = count;
  }
  visualEcho(event) {
    const record = this.combat.match(event.visual);
    if (
      event.actorId !== this.combat.scene?.selfId ||
      !record?.projectile?.descriptor
    ) {
      return false;
    }
    if (
      record.projectile.descriptor.bundle.sha256 !== event.visual.bundle.sha256
    ) {
      return false;
    }
    record.serverProjectile = true;
    const key = `${event.visual.id}:${event.visual.playbackId}`;
    if (record.projectileEchoes.has(key)) return true;
    if (record.projectileEchoes.size >= record.previewCount) return false;
    record.projectileEchoes.add(key);
    return true;
  }
  ammunitionEcho(event) {
    const record = this.combat.match(event);
    if (event.actorId !== this.combat.scene?.selfId || !record?.projectile) {
      return false;
    }
    record.serverProjectile = true;
    return (
      record.previewCount > 0 &&
      record.projectile.templateId === event.templateId
    );
  }
  draw(ms) {
    for (const flight of this.flights) {
      flight.age += ms;
      const t = Math.min(1, flight.age / flight.shot.duration),
        shot = flight.shot;
      flight.animation.setPosition(
        shot.x + (shot.endX - shot.x) * t,
        shot.y + (shot.endY - shot.y + flight.spread) * t,
      );
      flight.animation.advance(ms);
      if (t === 1 || flight.record.rejected) this.release(flight);
    }
  }
  release(flight) {
    this.combat.scene?.scene.removeWorldContainer(flight.animation.container);
    flight.animation.container.destroy(DESTROY);
    this.flights.delete(flight);
  }
  cancel(record) {
    clearTimeout(record.timer);
    for (const flight of this.flights) {
      if (flight.record === record) this.release(flight);
    }
    this.combat.scene?.events?.combat.cancelProjectilePreview(record.identity);
    record.projectileLease?.destroy();
    record.projectileLease = null;
  }
}
