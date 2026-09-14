import { AssetRegistry } from "./asset-registry.js";
import { compileMap } from "./compile-map.js";
import { compileMob } from "./compile-mob.js";
import { compileQuest } from "./compile-quest.js";
import { compileDrops } from "./compile-drops.js";
import { compileDialogue } from "./compile-dialogue.js";
import { imageAppearance } from "./appearance.js";
import {
  definitionReferences,
  referenceKey,
  validateContentRef,
  validateSave,
} from "./definitions.js";
import { CONTENT_LIMITS, contentError, requireContent } from "./validation.js";

const MAX_RESIDENT_BUILDS = 2;

/** Authoring/publishing authority. Published content is private to its owner and project. */
export class ContentService {
  constructor({ store, readJson, validateRuntime, inspectImage }) {
    this.store = store;
    this.readJson = readJson;
    this.validateRuntime = validateRuntime;
    this.inspectImage = inspectImage;
    this.registries = new Map();
  }

  async initialize(catalog) {
    const registry = new AssetRegistry({ catalog, readJson: this.readJson });
    await this.store.registerBuild(catalog);
    this.remember(registry);
  }

  remember(registry) {
    this.registries.delete(registry.buildId);
    if (this.registries.size >= MAX_RESIDENT_BUILDS) {
      this.registries.delete(this.registries.keys().next().value);
    }
    this.registries.set(registry.buildId, registry);
    return registry;
  }

  async registry(buildId) {
    if (this.registries.has(buildId)) {
      return this.remember(this.registries.get(buildId));
    }
    const catalog = await this.store.build(buildId);
    return this.remember(
      new AssetRegistry({ catalog, readJson: this.readJson }),
    );
  }

  async save(owner, input, admit) {
    const value = validateSave(input);
    const registry = await this.registry(value.baseAssetBuildId);
    return this.store.save(owner, value, {
      reservedId: (id) => originalIdentity(registry.catalog, id),
      admit,
    });
  }

  async publish(owner, ref, admit) {
    validateContentRef(ref);
    const row = await this.store.get(owner, ref);
    if (row.status === "published") {
      admit?.();
      return row;
    }
    const runtime = await this.compile(owner, row);
    return this.store.publish(owner, ref, runtime, admit);
  }

  /** Compile an unsaved draft for private inspection; never allocate a runtime ID or revision. */
  async preview(owner, input) {
    const value = validateSave(input);
    return this.compile(owner, {
      ...value,
      runtimeId: 899999998,
      revision: value.expectedRevision + 1,
    });
  }

  async compile(owner, row) {
    const registry = await this.registry(row.baseAssetBuildId);
    requireContent(
      !originalIdentity(registry.catalog, row.runtimeId),
      "Custom runtime identity collides with this base build",
    );
    const dependencies = await this.dependencies(owner, row, registry);
    const appearance = (value) =>
      this.appearance(owner, value, registry, dependencies);
    let runtime;
    if (row.kind === "map") {
      runtime = await compileMap(row, { registry, dependencies, appearance });
    }
    if (row.kind === "mob") {
      runtime = compileMob(
        row,
        dependencies,
        row.definition.appearance
          ? await appearance(row.definition.appearance)
          : null,
      );
    }
    if (row.kind === "quest") runtime = compileQuest(row, dependencies);
    if (row.kind === "drops") {
      runtime = compileDrops(row, dependencies, registry);
    }
    if (row.kind === "dialogue") runtime = compileDialogue(row, registry);
    runtime.schemaVersion = 1;
    runtime.identity = {
      projectId: row.projectId,
      id: row.id,
      revision: row.revision,
      runtimeId: row.runtimeId,
      baseAssetBuildId: row.baseAssetBuildId,
    };
    runtime.dependencies = dependencyClosure(row, dependencies);
    await this.validateRuntime(runtime, registry);
    return runtime;
  }

  async dependencies(owner, row, registry) {
    const dependencies = new Map();
    for (const ref of definitionReferences(row.kind, row.definition)) {
      const key = referenceKey(ref);
      if (dependencies.has(key)) continue;
      if (ref.source === "original") {
        dependencies.set(key, await registry.resolve(ref));
      } else {
        const target = await this.store.get(owner, {
          projectId: row.projectId,
          id: ref.id,
          revision: ref.revision,
        });
        requireContent(
          target.kind === ref.kind && target.status === "published",
          "Referenced custom content must be published",
          ref.id,
        );
        requireContent(
          target.baseAssetBuildId === row.baseAssetBuildId,
          "Dependencies must use the same pinned asset build",
          ref.id,
        );
        requireContent(
          target.id !== row.id,
          "Self-referencing content is unsupported",
          ref.id,
        );
        dependencies.set(key, target);
      }
    }
    return dependencies;
  }

  async appearance(owner, value, registry, dependencies) {
    if (value.source === "upload") {
      const image = await this.store.image(owner, value.assetId);
      const decoded = await this.inspectImage(image.bytes);
      return imageAppearance(value, { ...image, pixels: decoded.pixels });
    }
    const resolved =
      dependencies.get(referenceKey(value)) ?? (await registry.resolve(value));
    requireContent(resolved.visual, "Reference has no reusable appearance");
    return resolved.visual;
  }

  async upload(owner, bytes, admit) {
    requireContent(
      bytes instanceof Uint8Array &&
        bytes.length > 0 &&
        bytes.length <= CONTENT_LIMITS.uploadBytes,
      "Image byte limit exceeded",
    );
    const { width, height } = await this.inspectImage(bytes);
    return this.store.putImage(owner, { bytes, width, height }, admit);
  }

  async published(owner, ref) {
    const row = await this.store.get(owner, ref);
    if (row.status !== "published") {
      throw contentError(
        "CONTENT_NOT_FOUND",
        "Published revision was not found",
      );
    }
    return row;
  }
}

function dependencyClosure(row, dependencies) {
  const closure = new Map();
  for (const target of dependencies.values()) {
    if (target.status !== "published") continue;
    const inherited = target.runtime.dependencies ?? [];
    requireContent(
      inherited.length <= CONTENT_LIMITS.contentPerOwner,
      "Dependency limit exceeded",
    );
    for (const entry of [dependencyIdentity(target), ...inherited]) {
      requireContent(entry.id !== row.id, "Content dependency cycle", entry.id);
      const previous = closure.get(entry.id);
      requireContent(
        !previous || previous.revision === entry.revision,
        "Conflicting dependency revisions",
        entry.id,
      );
      closure.set(entry.id, entry);
      requireContent(
        closure.size <= CONTENT_LIMITS.contentPerOwner,
        "Dependency limit exceeded",
      );
    }
  }
  return [...closure.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
}

function originalIdentity(catalog, id) {
  return Boolean(
    catalog.maps[String(id).padStart(9, "0")] ||
    catalog.monsters?.[id] ||
    catalog.quests?.records?.[id],
  );
}

function dependencyIdentity(row) {
  return {
    id: row.id,
    revision: row.revision,
    kind: row.kind,
    runtimeId: row.runtimeId,
    publicationHash: row.publicationHash,
  };
}
