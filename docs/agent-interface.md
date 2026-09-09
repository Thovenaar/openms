# Agent interface and reversible experiments

The browser exposes `window.maple.agent` for **normal player actions and read-only observation**, and `window.maple.dev` for explicitly labeled **temporary development scenarios**. These are browser engineering interfaces, not a recovered original-client protocol or server authority. Both use the existing game, input, UI, renderer and profile owners; there is no second simulation.

Await `maple.ready` before using either surface. [Current gameplay boundaries](offline-gameplay.md), [original UI/input rules](ingame-ui.md) and [profile validation](offline-saves.md) still apply. Unsupported networking does not become available through agent control.

## Permission and human takeover

1. A human activates **Allow agent control** in the header. A script-generated button click cannot grant permission.
2. The agent calls `maple.agent.acquire("descriptive agent label")`. Labels are nonempty strings of at most80 characters.
3. The header shows active ownership and **Stop agent**. Permission is not saved or restored after reload.
4. Trusted keyboard down/up, pointer-down or wheel input immediately revokes active ownership before normal gameplay consumes the event. Window blur and hidden documents revoke permission too. The interrupted human event is not swallowed.
5. `maple.agent.release()` or Stop clears held input. A new grant is required to resume control. An interrupted asynchronous command cannot clear later human-owned input or reopen its cancelled window.

`agent.status()` reports permission, active ownership, generation, label, readiness, pending work and the last ownership reason. Only one action may be pending; commands are not queued. Malformed commands fail closed and require fresh permission. Ordinary gameplay refusal returns an explicit `{accepted:false, ...}` outcome instead of pretending success.

Read-only `observe`, `describe` and `capture` do not require a lease. Permission is an interaction safeguard, **not a JavaScript security sandbox**: scripts running in the page already share its origin and browser privileges.

## Normal action API

```js
await maple.ready;
// After the human grants permission:
maple.agent.acquire("movement investigation");
const result = await maple.agent.act({
  type: "action", action: "right", phase: "hold",
});
await maple.agent.act({ type: "action", action: "right", phase: "release" });
```

`agent.describe()` is the machine-readable source of supported command enums, current bindings, channels and source owners. Unknown fields, IDs, phases and enum values are rejected. Do not infer accepted names from visible abbreviations: the All channel is numeric7 or the exact string `"To All"`, not `"All"`.

| Type | Fields | Existing owner and semantics |
| --- | --- | --- |
| `key` | `code`, `phase` | Native physical `KeyboardEvent.code` values listed by `describe`; `GameUI.onKey` and `player-input` receive the admitted down/up edge. |
| `action` | `action`, `phase` | `left/right/up/down/jump/attack`; resolves the current live key map, not hard-coded jump/attack aliases. |
| `interact` | `id` | Resident `life:N` NPC ID; uses `LifeSystem.interactWorld` admission and the normal dialogue owner, not inspector selection. |
| `chat` | `text`, optional `channel` | Existing chat submission, sanitization,70-character limit, history, duplicate/flood gates and local speech. Server-only channels remain explicitly unavailable. |
| `inventory` | numeric item `id` | Existing owned-item use, death/modal/cooldown/effect checks and consumption. Does not create items. |
| `ui` | `name` | Listed windows toggle; `focusGame`, `close`, `confirm`, `cancel` and `chat` use normal UI primitives. A confirmation is a separate visible action. |
| `keyConfig` | `operation` and operation fields | Same live draft, validation, confirmation and explicit Save as human key configuration. |

`press` and `hold` both establish a down edge; **explicit `release` ends the hold**. Repeating a hold is idempotent, not keyboard auto-repeat. This lets an action span actual physics ticks rather than releasing it in a promise microtask before the game sees it. Movement and jump still obey terrain, current focus, modal state, death and gameplay locks. Modifier aliases retain independent physical holds until released. Browser-default text insertion and native button activation are not synthesized; use the explicit chat/UI commands or actual browser input.

Examples:

```js
await maple.agent.act({ type: "chat", text: "Hello", channel: 7 });
await maple.agent.act({ type: "inventory", id: 2000000 }); // requires ownership
await maple.agent.act({ type: "ui", name: "Item" });
await maple.agent.act({ type: "keyConfig", operation: "open" });
await maple.agent.act({
  type: "keyConfig", operation: "assign", code: "KeyA",
  binding: { type: 5, id: 52 }, // recovered Attack binding
});
await maple.agent.act({ type: "keyConfig", operation: "save" });
```

Key operations are `open`, `assign`, `remove`, `defaults`, `clear`, `quickslot`, `cancel`, `save`. Assignment takes `code`, `{type,id}` and optional `sourceCode`; removal takes `code`. Defaults, clear and dirty cancellation retain native confirmation. `quickslot` takes `action: "open" | "assign" | "save" | "cancel"`; assign also takes `slot:0..7` and `code`. Nested quick-slot Save accepts its draft; only explicit parent key Save publishes durable bindings. A failed save leaves the draft available. Human takeover during a save does not cancel a durable transaction already committed; it prevents late UI/focus ownership and leaves a retained editor editable.

## Observation and the actual screen

```js
const observation = maple.agent.observe({
  entities: { offset: 0, limit: 32 },
  inventory: { offset: 0, limit: 16 },
  skills: { offset: 0, limit: 16 },
  events: { since: 0, limit: 64 },
  ids: ["life:0"],
});
const png = maple.agent.capture();
// png: {mimeType, dataUrl, width, height, scope}
```

The detached schema1 observation contains current map/status, physics position/contact/bounds/settings, actual animation action/frame/playback and face expression/remaining duration, local gameplay phase, held input, UI/windows/chat/key draft, profile scalars and paginated inventory, camera/canvas dimensions, resident entities and recent events. Changing a returned object cannot mutate gameplay.

Entity and inventory pages accept limits1–128 and nonnegative offsets; default32. At most64 requested entity IDs are accepted. A known nonresident life ID is distinguished from an unknown ID. Resident artwork intersecting the logical viewport is **not** a claim of pixel visibility, unobstructed visibility or collision geometry. Hidden entities, unloaded regions, pending artwork and portals without artwork are absent; residency metadata states these limitations. Pages are live, not an atomic multi-call scene snapshot.

Schema3 profile observation includes ten detached SP pools and a paginated `skills` collection of `{id,level,masterLevel,expiresAt}` records. Skill pages share the1–128 limit/default32 rules. Reading a record does not grant it, cast it or bypass the existing skill authority. Persistent profile editing is a separately labeled sidebar development operation, not a normal agent command.

The preallocated256-event journal retains actual map/chat/combat events. `since` is an exclusive sequence cursor; follow `nextSince`, `hasMore` and `dropped`. Default event limit64, maximum128. Timeline resets are explicit epochs; sequence numbers remain monotonic. No full save, quest dictionary or full experimental profile is smuggled into the compact scenario status.

`capture()` renders and reads the **actual Pixi canvas** as PNG. It does not include DOM HUD/windows/chat or the permission controls. Use an actual full-page browser screenshot for complete visual acceptance; coordinates and state alone cannot prove rendering. Readback errors propagate rather than returning fabricated pixels. Observation/capture allocate on demand; normal human ticks do not build snapshots or scan the world for agents.

## Temporary scenarios and recording

A scenario suspends the complete current scene and its durable store, checkpoints existing progress, then prepares a separate scene with a validated **memory-only profile** and its own portal/UI clock. Begin requires finished loading, closed windows/chat, no pending save/reset and no key draft. A failed preparation retains the last complete field.

```js
const s = maple.dev.scenarios;
await s.begin({ mapId: "100000000", seed: 7 });
s.startRecording();
await maple.agent.act({ type: "action", action: "right", phase: "hold" });
await s.step(8); // eight actual30-ms physics ticks; no wall-clock sleep
await maple.agent.act({ type: "action", action: "right", phase: "release" });
const recording = s.stopRecording();
await s.run(recording);
await s.end(); // restore the suspended original scene/profile/view
```

`begin` accepts a packaged `mapId`, optional complete validated `profile`, uint32 `seed`, and optional temporary `physics`. Without a supplied profile it clones the checkpointed character and resolves the requested map's normal arrival. `snapshot()` explicitly returns the full canonical starting specification and scheduler metadata; use this development-only operation when a complete baseline is actually needed.

Physics overrides accept the named positive globals from `Physics.img` and positive `map.fs`, not arbitrary object mutation. `dev.describe()` exposes detached policy values, effective settings and exact editable source paths. `dev.describe({entityId:"life:N"})` returns that original placement/template definition. These operations do not make returned objects live or rewrite extracted WZ data.

Scenarios are paused and use the existing fixed30-ms update path. `step(n)` accepts0–8 ticks, awaits any owned portal load—including one started on the final tick—and does not advance extra physics during that wait. A recording must start immediately after begin, before commands or ticks. It stores all well-formed attempted commands with their tick and admission outcome, including normal refusals that can affect chat/UI gates. Replay compares outcomes and fails if admission changes.

A recording includes schema, quantum, full initial profile/map/overrides/seed, ordered commands, total ticks and an exact source-plus-asset identity. JavaScript/dependency build inputs are hashed separately from the extracted catalog. A different build is rejected before replacement or action execution. Replay bounds are120,000 ticks and16,384 actions; it yields a browser task after at most8 ticks or64 same-tick commands so native interruption can run. It does not silently drop accumulated work.

`random()` is a seeded Mulberry32 stream **for scenario tooling only**. It does not replace `Math.random`, add random gameplay or claim original RNG fidelity. Recorded commands preserve the chosen actions, not arbitrary external tool code or wall-clock execution. Fixed-tick replay is not a claim that unrecovered server behavior, browser audio scheduling or arbitrary scripts are deterministic.

The header marks **Experimental · temporary profile** and offers **Exit experiment**. Save, key Save, reset, combat, quests and items inside the experiment target the memory store; they never publish temporary progress to IndexedDB. Exit restores the retained original field/store, input ownership, chat state and view settings. Beginning may flush existing baseline progress; it does not discard unsaved durable gameplay.

Human takeover stops agent work and resumes normal human ticks in the **temporary** field. It does not silently delete the experiment underneath the human. Exit remains available without agent permission. Temporary setup and reset/save continuations are ownership-scoped so they cannot modify a subsequently restored baseline UI. There is deliberately no automatic “apply experiment to durable save” operation.

## Editing and ownership

| Module | Responsibility |
| --- | --- |
| `agent-control.js` | Trusted grant, lease, visible ownership, interruption and asynchronous command cancellation. |
| `player-actions.js`, `player-input.js` | Normal-action admission and the shared physical input owner. |
| `agent-observation.js` | Detached bounded observations, event journal and actual canvas readback. |
| `agent-scenarios.js` | Validated fixed-tick specification, recording/replay and bounded scheduling. |
| `agent-development.js` | Suspended baseline versus temporary scene/store lifetime. |
| `agent-integration.js`, `main.js` | Narrow public facades and existing application ownership cutover. |

Permanent changes belong in the documented source owners: `physics/` for movement, `keymap.js`/`key-bindings.js` for bindings, `offline-field.js`/`offline-mobs.js`/`offline-progression.js` for local gameplay, `profile-validation.js` for saved contracts, and `client/tools/life-data.js` for original entity extraction. Follow the [coding style](coding-style.md), migrate affected callers and rebuild with Bun. Temporary development overrides are not an alternative persistent rules system.

## Executed browser acceptance

The [retained report](agent-validation/report.json) and [recorded sequence](agent-validation/recording.json) cover the source/asset identity embedded in the recording. This is browser-reconstruction proof, not a Windows-original parity claim.

- Nine normal commands replayed at the same24 fixed ticks: movement, jump, attack, one admitted potion use, one cooldown refusal, and local All-channel speech. Position, body action, HP/MP, inventory and chat history matched. The potion raised HP20→55, consumed one of two items, and the same-tick refusal consumed nothing.
- Repeating a held Equip hotkey after asynchronous window focus preserved the same windows; release followed by a new hold toggled once.
- A resident NPC opened its normal current dialog; modal ownership rejected movement. The forthcoming original-behavior corrections remain separate from this proof that agents share the current human owner.
- A real physical key release revoked an admitted agent Right hold. After native Escape closed the blocking NPC dialog, native Left moved X116.0543→69.125 over400 ms with agent permission off.
- An actual IndexedDB completion was deliberately delayed during explicit key Save. Native pointer takeover and a new Right hold survived completion; the old agent command rejected, and the retained key editor remained editable.
- Temporary key Save did not change the restored durable binding. The original scene/store was reinstated on Exit.
- The authored automatic portal `103040000/upStair` transferred to `103040100` on tick1. Step waited for readiness; an immediate next action was admitted. The manifest was cached, so no injected network delay occurred; the separately retained scheduler regression covers deferred final-tick readiness.
- With the visible game in native-play mode and agent control disabled,120 rAF intervals spanned2000 ms; p95 and maximum were approximately16.8 ms. This is a short measured continuity check, not a hardware-independent performance guarantee.
- Strict lint and69 regressions/421 assertions passed. VitePress built successfully and the actual documentation article/sidebar were inspected in the browser. Its existing large-chunk warning remains visible.

![Actual game surface with opt-in ownership and temporary experiment indicator](agent-validation/game.png)

[Actual canvas-only capture](agent-validation/canvas.png) is retained separately from the complete browser surface.
