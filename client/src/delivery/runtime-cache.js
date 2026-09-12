import {
  selectedProfileResources,
  profileResourceKey,
} from "./selected-profile-resources.js";

/** The live world owns cache publication; character persistence owns profile preparation. */
export class RuntimeCache {
  constructor(hooks) {
    this.hooks = hooks;
    this.scenes = new WeakMap();
    this.profiles = new WeakMap();
    this.mapPublication = Promise.resolve(true);
    this.restoration = null;
    this.retained = null;
    this.queuedMap = null;
    this.prepareProfile = this.prepareProfile.bind(this);
    this.releaseScene = this.releaseScene.bind(this);
  }

  bootstrap(store) {
    const catalog = this.hooks.catalog();
    const profile = store.profile;
    const resources = selectedProfileResources(catalog, profile);
    this.rememberProfile(store, profileResourceKey(profile), catalog.buildId);
    return { mapId: profile.location.mapId, resources };
  }

  rememberProfile(store, key, buildId) {
    this.profiles.set(store, { key, buildId });
  }

  async ready() {
    if (this.restoration) await this.restoration;
    if (this.retained?.releasing && !(await this.releaseBaseline())) {
      throw new Error(
        "The restored field's offline cache publication is still pending",
      );
    }
    await this.mapPublication;
    await this.hooks.delivery().retryPublication();
  }

  async prepareMap(mapId, signal, store) {
    await this.ready();
    const queued = this.queuedMap;
    this.queuedMap = null;
    if (queued && this.matchesQueuedMap(queued, mapId, store)) {
      return queued.preparation;
    }
    const operation = this.hooks
      .delivery()
      .prepareMap(
        mapId,
        signal,
        selectedProfileResources(this.hooks.catalog(), store.profile),
      );
    this.mapPreparation = operation;
    try {
      return await operation;
    } finally {
      if (this.mapPreparation === operation) this.mapPreparation = null;
    }
  }

  matchesQueuedMap(queued, mapId, store) {
    return (
      queued.store === store &&
      queued.preparation.mapId === mapId &&
      queued.key === profileResourceKey(store.profile) &&
      queued.buildId === this.hooks.catalog().buildId &&
      queued.preparation.preparationId ===
        this.hooks.delivery().preparedMap?.preparationId
    );
  }

  trackScene(scene, preparation) {
    this.scenes.set(scene, { preparation, adopted: false });
  }

  adoptScene(scene, store) {
    const record = this.scenes.get(scene);
    // A retained baseline is republished by releaseBaseline, never with its expired token.
    if (record?.adopted) return;
    if (record) record.adopted = true;
    this.mapPublication = this.commitScene(scene, store, record);
  }

  async commitScene(scene, store, record) {
    try {
      if (!record) {
        throw new Error("The adopted field has no verified cache preparation");
      }
      this.rememberProfile(
        store,
        profileResourceKey(store.profile),
        this.hooks.catalog().buildId,
      );
      await this.hooks
        .delivery()
        .commitMap(scene.manifest.id, record.preparation.preparationId);
      return true;
    } catch (error) {
      this.hooks.report(error);
      return false;
    }
  }

  releaseScene(scene) {
    const record = this.scenes.get(scene);
    if (!record || record.adopted) return;
    this.scenes.delete(scene);
    this.discardMap(record.preparation).catch(this.hooks.report);
  }

  async discardMap(preparation) {
    if (!preparation) return;
    await this.hooks.delivery().discardMap(preparation.preparationId);
  }

  profilePlan(profile, store) {
    const delivery = this.hooks.delivery();
    const scene = this.hooks.scene();
    if (store !== this.hooks.store() || !delivery?.launchReady || !scene) {
      return null;
    }
    const catalog = this.hooks.catalog();
    const key = profileResourceKey(profile);
    const previous = this.profiles.get(store);
    const needsProfile =
      previous?.key !== key || previous?.buildId !== catalog.buildId;
    const mapId = profile.location.mapId;
    const needsMap =
      mapId !== scene.manifest.id && delivery.preparedMap?.mapId !== mapId;
    if (!needsProfile && !needsMap) return null;
    return {
      store,
      key,
      buildId: catalog.buildId,
      mapId,
      needsProfile,
      needsMap,
      resources: selectedProfileResources(catalog, profile),
    };
  }

  async prepareProfile(profile, store) {
    const plan = this.profilePlan(profile, store);
    if (!plan) return null;
    await this.ready();
    const delivery = this.hooks.delivery();
    if (this.mapPreparation) await this.mapPreparation;
    plan.needsMap =
      plan.mapId !== this.hooks.scene().manifest.id &&
      delivery.preparedMap?.mapId !== plan.mapId;
    let map = null;
    let token = null;
    try {
      if (plan.needsMap) {
        map = await delivery.prepareMap(
          plan.mapId,
          this.hooks.signal(),
          plan.resources,
        );
      }
      if (plan.needsProfile) {
        token = await delivery.prepareProfile(
          plan.resources,
          this.hooks.signal(),
        );
      }
    } catch (error) {
      await this.discardMap(map).catch(this.hooks.report);
      throw error;
    }
    return {
      commit: () => this.commitProfile(plan, token, map),
      discard: () => this.discardProfile(token, map),
      report: this.hooks.report,
    };
  }

  async commitProfile(plan, token, map) {
    if (map) {
      this.queuedMap = {
        preparation: map,
        store: plan.store,
        key: plan.key,
        buildId: plan.buildId,
      };
    }
    // Even failed metadata publication keeps these already-verified roots protected.
    // Unchanged vitals saves must not become retries of an unrelated cache warning.
    this.rememberProfile(plan.store, plan.key, plan.buildId);
    if (token) await this.hooks.delivery().commitProfile(token);
  }

  async discardProfile(token, map) {
    try {
      if (token) await this.hooks.delivery().discardProfile(token);
    } finally {
      await this.discardMap(map);
    }
  }

  async retainBaseline() {
    await this.ready();
    if (this.retained) {
      throw new Error("An offline baseline is already retained");
    }
    const token = crypto.randomUUID();
    this.retained = { token, releasing: false };
    await this.hooks.delivery().retainCurrentMap(token);
  }

  releaseBaseline() {
    if (!this.retained) return Promise.resolve(true);
    this.retained.releasing = true;
    if (this.restoration) return this.restoration;
    const attempt = this.restoreBaseline(this.retained);
    this.restoration = attempt;
    return attempt.finally(() => {
      if (this.restoration === attempt) this.restoration = null;
    });
  }

  async restoreBaseline(retained) {
    try {
      await this.mapPublication;
      const delivery = this.hooks.delivery();
      await delivery.retryPublication();
      const scene = this.hooks.scene();
      const store = this.hooks.store();
      const preparation = await delivery.prepareMap(
        scene.manifest.id,
        this.hooks.signal(),
        selectedProfileResources(this.hooks.catalog(), store.profile),
      );
      const record = { preparation, adopted: true };
      this.scenes.set(scene, record);
      if (!(await this.commitScene(scene, store, record))) return false;
      await delivery.releaseRetainedMap(retained.token);
      if (this.retained === retained) this.retained = null;
      return true;
    } catch (error) {
      this.hooks.report(error);
      return false;
    }
  }
}
