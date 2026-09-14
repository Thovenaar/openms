# Studio: `@openms/studio`

Complete [Quick Start](../index.md) through asset extraction, PostgreSQL startup and the explicit database migration. Then open **http://127.0.0.1:3103** after starting these commands in separate terminals:

```sh
bun run server:dev
bun run studio:dev
```

Studio has its own listener and uses the existing account login. The backend development launcher provisions the usual development accounts; Studio does not create or elevate accounts. The game client is optional for authoring: run `bun run client:dev` on port **3102** when ready to play.

The workspace packages are `@openms/client`, `@openms/server`, `@openms/content` and `@openms/studio`. Studio owns the browser interface, content owns the authoring contracts and persistence, and server owns publication admission and shared-world activation. The dashboard reuses the client's Pixi renderer, atlas decoder and original resources for previews. No generated asset file is edited.

## Create and publish

1. Choose a project ID and create a map, mob or quest in **My creations**. Names are readable labels; the stable content ID is generated from the initial name and becomes fixed after saving.
2. Search the **Asset library** by original name or ID. For a map or mob, **Use as base** selects its original definition. **Scenery in a map** browses the current base map. Published mobs in the project appear above the original library and can be selected for spawns or quest objectives.
3. Use the property editor and **Update preview** to validate the draft. **Save draft** appends a database revision. **Publish revision** first saves pending changes, then compiles and freezes the revision. Publishing adds it to the release selection; it does not change the game world.
4. In **Shared world**, review the exact published selection and activate it with a developer account while the world is idle. Required custom dependencies are included automatically. Players reload the game to pick up the release and enter active maps from **Community maps**.

Each activation replaces the previous selection. Keep creations that should remain available in the next selection. A new revision of an existing creation does not silently replace the revision already active in the world. Conflicting saves/activations fail explicitly; reload the current state before choosing the next revision.

## Editors

**Maps.** Start from an original map. Select a published or original mob and click with **Spawn mob**; the editor places its feet on the nearest walkable foothold. Select original scenery, an original mob appearance or an uploaded PNG and click with **Decoration**. Drag **Platform** or **Ladder** to add geometry, or drag **Pan** to inspect the scene. The property panel edits placement coordinates, depth, flips, footholds, bounds and original placement removals. Geometry markers update immediately; **Update preview** recompiles decorations. The map preview shows scenery and spawn markers; authoritative moving mobs are visible when the map is activated in the game.

**Mobs.** Choose an original base and override supported stats. Blank fields inherit the base value. To replace artwork, upload a PNG and edit its frame rectangles, origins, delays and body rectangles. Studio initially assigns the whole image to every action required by the base; refine those frames for a sprite sheet. Update preview to inspect the animation and catch frame errors. Bases with authored attack animations cannot replace their artwork in this version.

**Quests.** Choose start/finish NPCs by original map and NPC ID, or browse the selected map's NPCs. Add level requirements, completed-quest prerequisites, kill/collect objectives, fixed rewards and four dialogue messages. Selecting a published mob before **Add objective** creates a kill objective bound to that exact custom revision. Original quest records can be inspected in the asset library and referenced as prerequisites; automatic conversion of arbitrary original quest branches into the simpler custom schema is not provided.

The **Advanced definition** panel supports precise edits to the same closed JSON contract. Apply compiles it before replacing the edit. This is useful for large removal lists or exact geometry. Arbitrary scripts, AI, new item definitions and custom portal/NPC behavior remain outside the supported authoring schema.

Unsaved edits remain in memory and navigating away warns before discarding them. Saved revisions, publications, uploaded PNG bytes and activated releases live in PostgreSQL. See [content storage, identity and updates](content.md) for pinning/re-extraction behavior and player-location/quest-progress protections.

## Build, routing and validation

Studio loads [`.env.studio`](../../.env.studio) relative to the repository, independently of the working directory. Process environment overrides the file; programmatic launch options override both. Restart Studio after changing its settings or source.

| Setting               | Default                   | Purpose                                                      |
| --------------------- | ------------------------- | ------------------------------------------------------------ |
| `STUDIO_HOST`         | `127.0.0.1`               | Studio bind address                                          |
| `STUDIO_PORT`         | `3103`                    | Dedicated Studio port                                        |
| `OPENMS_SERVER_URL`   | `http://127.0.0.1:3200`   | Backend API origin                                           |
| `OPENMS_CLIENT_URL`   | `http://127.0.0.1:3102`   | Public destination of game links                             |
| `OPENMS_CONTENT_ROOT` | `client/public/generated` | Existing extraction for previews, relative to the repository |

The backend's `.env.server` separately sets `OPENMS_STUDIO_ORIGIN=http://127.0.0.1:3103`. When changing Studio's public host or port, update that exact browser origin and restart the backend too. Development admits the same scheme/port on `localhost`, `127.0.0.1` and `[::1]`; production requires the exact configured HTTPS origin. Keep both listeners' `OPENMS_CONTENT_ROOT` pointed at the same extraction.

`bun run studio:build` builds Studio's browser JS and atlas worker. `studio:dev` and `studio:start` compile and serve the dashboard on its own listener, at `/` or `/studio/`. That listener serves original `/generated/*` resources directly and proxies only config, sign-in/sign-out, challenges and custom-content API requests to the backend. It preserves the browser's Origin, cookies and CSRF proof; the backend admits the Studio origin only for these authoring/session routes. The game listener and backend no longer serve the dashboard. Game links use `OPENMS_CLIENT_URL`; neither authoring nor previews require the game listener.

For production, run `bun run studio:start` behind HTTPS on Studio's separate public origin and configure `OPENMS_STUDIO_ORIGIN` on the backend. Route the Studio origin to the Studio listener, preserving Origin and cookies; the game keeps its own HTTPS/WSS routing. Keep Studio's API and dashboard routes network-only. Only the public game URL reaches browser settings; database credentials and host configuration stay on the server. Saved content and uploaded assets continue to live in PostgreSQL.

`bun test studio/test server/test/login-origin.test.js server/test/content-http.test.js` checks the dedicated listener, original-resource serving, scoped configuration, proxy headers/uploads and backend origin admission without starting a game or database.

`bun run check:studio` creates a disposable PostgreSQL database, separate game/Studio listeners and isolated browser contexts. It exercises native login, PNG upload, map placement, quest editing, publication, activation, two-account travel/recipient updates, quest acceptance and reconnect/restart. Its JSON report, stage timings and screenshots default to `/tmp/openms-studio`; pass a directory argument to retain them elsewhere. It reuses the existing extraction and never changes the configured development database. This is a focused opt-in check, not a full extraction or smoke run.
