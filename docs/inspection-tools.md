# Online inspection and development console

The header and sidebar are OpenMS development tools, separate from the reconstructed MapleStory windows. The badge states the active authority: **SERVER · GM** for an authorized developer session and **SERVER** for ordinary players and production sessions.

## Sections and ownership

The console has World, Character, Diagnostics, Agent and Settings sections. Switching sections preserves mounted draft values and does not grant permissions.

| Section | Current online behavior |
| --- | --- |
| World | Reads map, scene, entity, geometry and camera state. Render previews affect only this browser. Map travel, monster spawn, pause and step use audited server development actions. |
| Character | Shows server-published profile state. An authorized developer may stage and submit validated profile edits, presets and world-item conjures to the server. |
| Diagnostics | Shows bounded connection, content identity, prediction, quest and recent operation state. Resync and reconnect use the live transport. |
| Agent | Hosts the human permission control, normal-action lease and audited server experiment controls. |
| Settings | Owns inspection theme and audio controls. Theme changes affect only inspection chrome. |

The retired download/update panel, browser-local save/reset controls, local multiplayer simulation and live local-placement editor are absent from the online client.

## Login presentation

The console remains available during account entry, registration, character selection and creation. **Login scene · animation and transitions** shows a bounded presentation snapshot without passwords or challenge proofs.

- **Pause animation** stops the login presentation clock.
- **Step 30 ms** advances a paused login presentation by one fixed step.
- **Replay transition** replays the last presentation transition without changing account or character state.
- Character refresh and sign-out remain available at the character-selection stage.

These controls do not require developer authorization because they mutate presentation only. Field controls remain disabled before entry.

## World inspection

Entity search is bounded and operates on the current render snapshot. It can select an entity, inspect supported actions, change local visibility/layer previews and center the camera. Character and mob poses remain owned by server observations; the client refuses direct pose overrides for those live actors.

Geometry references are demand-loaded from the verified catalog. Selecting one changes only diagnostic drawing. It does not create a collision, hit or gameplay action.

Map travel and monster spawn require all of the following:

- a development-mode server;
- an authenticated developer role;
- an active session and owned field;
- a valid closed development request;
- a committed server receipt.

Unknown transport outcomes recover the same operation ID. The client does not submit a second mutation to guess whether the first committed.

## Character editing

Only authorized developer sessions mount the full character editor. Staged edits remain drafts until **Apply changes**. Job presets use packaged skills/equipment and the same server validation as the submitted profile patch. A failed request keeps the draft visible.

Applied changes persist according to server rules. **Revive character** uses the normal revive request. Browser-local checkpoint and reset operations are not available.

**Conjure world item** sends an audited server action that creates a transient field drop after server validation. It does not place an item directly into inventory; ordinary pickup performs the durable credit. Reactor testing likewise requires an actually owned item and the normal server interaction.

## Diagnostics and lifecycle

The diagnostics section separates connection, asset/rules/catalog identity, prediction, quests, peers and recent operations. Technical observations are bounded text projections. Successful map changes clear current failure state without erasing the operation journal.

Hide/show tools resizes the canvas through the normal viewport owner. Inspection theme variables remain scoped to `.inspection-chrome`; they do not alter original game artwork or reconstructed native windows.

The online inspection owner removes its listeners, agent lease, controls and temporary presentation objects during shutdown. It never owns server persistence or authoritative field state.

See the [agent interface](agent-interface.md) for the automation API, the [online integration contract](reconstruction-contract.md) for authority, and the [validation procedure](validation-method.md) for evidence requirements.
