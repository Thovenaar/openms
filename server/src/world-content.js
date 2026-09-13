import { ServerContent } from "./content.js";
import { WorldContentStore } from "@openms/content/world-store";
import { contentError, digest } from "@openms/content";
import { applyWorldContent } from "../../shared/world-content.js";
import { catalog as validateCatalog } from "../../client/src/rendering/stream-validation.js";
import { prepareRelease } from "./content-release.js";
import { canRetireField, retireIdleField } from "./field-retirement.js";

/** One installed release owns its cache; generated resources remain owned by the original reader. */
export class WorldContent extends ServerContent {
  constructor(original, store) {
    super(original.root);
    this.original = original;
    this.store = store;
    this.rulesHash = original.rulesHash;
    this.assetBuildId = original.assetBuildId;
    this.catalogHash = original.catalogHash;
    this.items = original.items;
    this.questControls = original.questControls;
    this.install(null);
  }

  prepare(release) {
    const catalog = release
      ? validateCatalog(
          applyWorldContent(this.original.catalog, release.overlay),
        )
      : this.original.catalog;
    return {
      release,
      catalog,
      quests: {
        ...this.original.onlineQuests,
        records: {
          ...this.original.onlineQuests.records,
          ...release?.overlay.quests,
        },
        strings: catalog.quests.strings,
      },
    };
  }

  install(release, prepared = this.prepare(release)) {
    this.release = release;
    this.catalog = prepared.catalog;
    this.onlineQuests = prepared.quests;
    this.worldContent = release?.descriptor ?? null;
    this.resourceIds = new Set(release?.resources ?? []);
    this.maps.clear();
  }

  async json(descriptor) {
    if (!descriptor.url.startsWith("/api/v1/world-content/resources/")) {
      return this.original.json(descriptor);
    }
    if (
      !this.resourceIds.has(descriptor.sha256) ||
      descriptor.url !== `/api/v1/world-content/resources/${descriptor.sha256}`
    ) {
      throw contentError("ASSET_NOT_FOUND", "World resource is not active");
    }
    const resource = await this.store.resource(descriptor.sha256);
    if (
      resource.mediaType !== "application/json" ||
      resource.bytes.byteLength !== descriptor.bytes
    ) {
      throw contentError(
        "INVALID_CONTENT",
        "World resource descriptor mismatch",
      );
    }
    return JSON.parse(new TextDecoder().decode(resource.bytes));
  }
}

export class WorldActivation {
  constructor({ database, content, service }) {
    this.database = database;
    this.content = content;
    this.service = service;
    this.busy = false;
    this.world = null;
    this.gateway = null;
  }

  status() {
    const release = this.content.release;
    return {
      generation: release?.generation ?? 0,
      projectId: release?.projectId ?? null,
      selection: release?.selection ?? [],
      descriptor: this.content.worldContent,
      players: this.world?.actors.size ?? 0,
      busy: this.busy,
    };
  }

  bind(world, gateway) {
    this.world = world;
    this.gateway = gateway;
    gateway.activation = this;
  }

  idle() {
    if (
      this.world.actors.size ||
      this.world.fieldLoads.size ||
      this.gateway.joining.size ||
      this.content.pendingMaps.size
    ) {
      throw contentError(
        "CONTENT_CONFLICT",
        "Sign out all characters before activating a world release",
      );
    }
    for (const field of this.world.fields.values()) {
      if (!canRetireField(this.world, field)) {
        throw contentError(
          "CONTENT_CONFLICT",
          "The world still has pending field activity; wait for it to settle",
        );
      }
    }
  }

  async activate(owner, input, admit) {
    if (this.busy) {
      throw contentError(
        "CONTENT_CONFLICT",
        "A world release is already in progress",
      );
    }
    this.busy = true;
    try {
      this.idle();
      const prepared = await prepareRelease(
        this.service,
        owner,
        input,
        this.content.original,
      );
      const candidate = this.content.prepare({ overlay: prepared.overlay });
      const release = await this.content.store.save(
        owner,
        input,
        prepared,
        async (tx) => {
          admit();
          this.idle();
          await protectSavedCharacters(tx, this.content.release, prepared);
        },
      );
      for (let count = this.world.fields.size; count > 0; count--) {
        if (!retireIdleField(this.world)) {
          throw contentError("CONTENT_CONFLICT", "Field retirement failed");
        }
      }
      this.content.install(release, candidate);
      return { ...this.status(), busy: false };
    } finally {
      this.busy = false;
    }
  }
}

async function protectSavedCharacters(tx, previous, prepared) {
  const [leased] =
    await tx`SELECT id FROM character WHERE lease_until>clock_timestamp() LIMIT 1`;
  if (leased) {
    throw contentError(
      "CONTENT_CONFLICT",
      "An active character lease prevents world activation",
    );
  }
  const next = new Map(prepared.selection.map((row) => [row.runtimeId, row]));
  for (const old of previous?.selection ?? []) {
    const current = next.get(old.runtimeId);
    if (current?.publicationHash === old.publicationHash) continue;
    if (old.kind === "map") {
      const [saved] =
        await tx`SELECT id FROM character WHERE map_id=${old.runtimeId} LIMIT 1`;
      if (saved) {
        throw contentError(
          "CONTENT_CONFLICT",
          `A saved character is still in ${old.name}; move them before changing or removing it`,
        );
      }
    }
    if (old.kind === "quest") {
      const [progress] =
        await tx`SELECT id FROM character WHERE profile->'quests' ? ${String(old.runtimeId)} LIMIT 1`;
      if (progress) {
        throw contentError(
          "CONTENT_CONFLICT",
          `Players have progress in ${old.name}; create a new quest identity instead`,
        );
      }
    }
  }
}

export async function worldResourceResponse(content, path) {
  const [kind, id, extra] = path.split("/");
  if (extra || !/^[a-f0-9]{64}$/.test(id)) {
    return new Response("Not found", { status: 404 });
  }
  let bytes, mediaType;
  if (kind === "catalog" && id === content.worldContent?.sha256) {
    bytes = new TextEncoder().encode(content.release.encoded);
    mediaType = "application/json";
  } else if (kind === "resources" && content.resourceIds.has(id)) {
    ({ bytes, mediaType } = await content.store.resource(id));
  } else return new Response("Not found", { status: 404 });
  if (digest(bytes) !== id) {
    throw contentError("INVALID_CONTENT", "World resource integrity mismatch");
  }
  return new Response(bytes, {
    headers: {
      "Content-Type": mediaType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function loadWorldContent(database, original) {
  const store = new WorldContentStore(database.sql);
  const content = new WorldContent(original, store);
  content.install(await store.current());
  return content;
}
