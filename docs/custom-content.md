# Custom content

Create maps, mobs and quests using original assets, uploaded PNGs, or both. Complete [Quick Start](index.md) first.

## Open Studio

Keep PostgreSQL and the server running. In another terminal:

```sh
bun run studio:dev
```

Open **http://127.0.0.1:3103** and sign in with **`admin` / `password`**. Studio has its own port and `.env.studio`; the game client can be stopped while authoring.

## Create

1. Choose a project and create a map, mob or quest in **My creations**.
2. Search the **Asset library** for existing assets, or upload a PNG for custom artwork.
3. Edit the definition, choose **Update preview**, then **Save draft**.

## Publish

1. Choose **Publish revision** to freeze a revision.
2. In **Shared world**, select the publications to include and activate them while the world is idle.
3. Reload the game. Active custom maps appear in **Community maps**.

Each activation replaces the previous selection, so include anything that should remain available. Saving or publishing alone does not change the live world.

## Storage

Drafts, revisions, uploaded PNGs and world releases are stored in PostgreSQL. Original generated assets stay unchanged. Publications pin the asset build and custom revisions they use; re-extraction does not silently update a published world.

See [Studio](server/studio.md) for editor details and [Content](server/content.md) for storage, publishing and asset updates.
