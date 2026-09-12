# External game-master console

The header and sidebar are browser development tools, not reconstructed native MapleStory windows. The console badge states authority: offline it reads **LOCAL**; online it reads **SERVER · GM** for an authorized developer in development mode and **SERVER** otherwise. Character changes use the existing validated local profile authority offline and audited server development requests online. Render previews do not grant rewards, inflict damage, or rewrite original WZ metadata.

## Workspace and themes

- The console is one sidebar with a **Tool section** dropdown (`#console-section`), not a row of tabs. Its five sections — **World**, **Character**, **Diagnostics**, **Agent** and **Settings** — are task groups, not a sequence. Selecting an option reveals exactly one panel; the others carry `hidden`. Their DOM remains mounted, so switching sections preserves unsaved form values. The chosen section persists under `maple-inspection-section-v1`; the default is World and the sidebar opens on desktop unless a saved preference overrides it. A persisted `field` choice migrates to `world`.
- **World** owns the current-map readout, map selection/travel and monster selection/spawn alongside scene inspection. Offline, map travel and spawn use the validated local field. Online, they are audited server development requests requiring an authorized GM developer session, and the server validates field ownership. Pause/reload/step and native KeyConfig remain in the shared toolbar outside the section panels. Volume readouts show percentages without changing the native0–128 audio range.
- **Character** shows identity and HP/MP first behind the `#inspection-controls` host. Presets, attributes, progress/wallet, skill editing, and destructive actions remain available behind named disclosures. Apply/Discard are disabled when there is no draft. Offline the editor commits through the validated local profile authority. Online the same editor requires an authorized GM developer session; an unauthorized session states that requirement in place of an empty panel.
- **World** groups scene entities, physics geometry, camera controls and the life placement host. Scene-dependent controls remain disabled until a map exists. Entity/action/visibility/layer changes and camera moves are session-only previews in both clients and never rewrite original assets. The **NPC & mob placement inspector** reads local placement metadata and is offline-only; the online console says so in the world section hint. A world mob selection reveals **World** and its exact life placement.
- **Diagnostics** groups runtime diagnostics (stepping, physics status, settings and status output), the error log and the state/testing host. **Diagnostics → Error log** projects the same bounded, deduplicated session journal as native Game Logs into selectable readonly text. Errors never insert a banner above World or shift its controls. New records preserve text while it is focused for copying; blur refreshes the journal. Successful map changes clear current failure state, not log history. Startup failures remain visible before the renderer is ready. Online, resync and reconnect use the live transport, while pause and step remain audited server development requests.
- **Agent** alone contains **Allow agent control**, **Stop agent**, ownership status, **Experimental · temporary profile**, and **Exit experiment**. Switching sections does not grant permission or move these controls into another panel. Offline these controls drive the local session; online the same mutations are audited server development requests and still need an explicit human grant.
- **Settings** contains the existing XP and Windows95 theme choice, the sound host and, offline only, offline-release tools. The online shell removes the offline download host from the derived markup. The theme still persists under `maple-inspection-theme-v1`; storage failures are reported. Only these tools change; the game artwork stays original.
- Presentation-only in both clients: scene entity/action/visibility/layer previews, camera moves and the theme choice. They change only what this browser renders and never mutate server or local gameplay authority. Scene and camera controls stay disabled until a map exists.
- Theme attributes and variables remain on `.inspection-chrome` only. The body, viewport, and `.maple-ui-root` do not inherit the console theme.
- **Hide tools** expands the canvas; **Show tools** restores it through the existing viewport resize owner. On desktop, the toolbar stays outside each panel's scroll area rather than covering scrolled controls. Below 960px, tools follow the game in ordinary page flow.
- Pause/resume, step, key bindings and reload remain in the shared toolbar **above all five sections**, outside panel scrolling. Error/status feedback is also outside the task panels; Agent permissions/Exit are not. Static console navigation initializes before renderer startup, so a renderer failure cannot strand the offline controls.

The design follows [NN/G progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) and the GOV.UK guidance for [details](https://design-system.service.gov.uk/components/details/) and [select](https://design-system.service.gov.uk/components/select/): keep frequent controls visible, give secondary groups descriptive labels, and use a small set of independent tasks instead of a wizard or deeply nested settings tree. These are external-tool design choices, not reconstructed MapleStory chrome.

## Character editing and presets

Open **Character**. Identity and HP/MP use a two-column form, with full-width name/job fields. Editing job or level does not perform a job advancement or grant automatic points/skills. Offline the editor uses the validated local profile authority; online it is available only to an authorized GM developer session, which commits every edit as an audited server development request.

1. Choose a preset and press **Preview preset**.
2. Review the staged form values. The live profile has not changed.
3. Press **Apply changes** to call the existing `onProfileEdit` hook and its `CharacterDevelopment.edit` / `ProfileStore.commitProfile` transaction. All normal schema, skill catalog, ownership and persistence checks remain in force.
4. **Discard** restores the current profile. An existing draft blocks another preset until explicitly applied/discarded. Failed saves retain the draft and show the failure; invalid fields automatically reveal their enclosing disclosure. Presets reveal the groups whose values they change.

Presets are explicit GM policies, not native game grants:

| Preset            | Fields replaced                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Restore resources | HP and MP become the current profile's maximum HP and MP.                                                                                  |
| Training budget   | AP becomes 20; only SP pool 0 becomes 10. Other SP pools, learned skills, job and level are untouched.                                     |
| Drop testing      | Wallet becomes exactly 100,000 mesos; no drop is spawned. Use the native inventory meso-drop action to exercise drop authority separately. |

**Save checkpoint** retains the existing persistence action; **Revive character** retains its existing admission rules. Reset remains behind **Destructive actions** and uses the existing confirmation owner. Reactor offering uses an owned inventory item and the existing offering hook, not a fabricated inventory grant.

**Conjure world item** searches the complete packaged item catalog by name or ID, with at most200 displayed matches and explicit refinement feedback. It creates a real transient drop in front of the character after metadata, ground, ownership and original-art preflight; it does not directly grant inventory. Normal settlement and pickup perform the durable credit. Reactor offering uses the same searchable catalog but still requires actual owned quantity.

## Bounded entity inspection

The previous scene and life selectors appended every ID to an undifferentiated dropdown. Finding a late placement required manually traversing the entire option list. The console now provides bounded, reusable on-demand searches rather than scanning or rebuilding searchable strings every simulation frame.

- **Find entity by ID** matches case-insensitive kind and ID in the current render snapshot. Search, select an entity, then inspect its actual actions/visibility/layer or **Center camera** on its reported coordinates. Centering uses the existing camera API (which disables follow); Reset restores follow.
- Render action/visibility/layer changes are session-only previews. Layer controls reuse `setLayer`; they are not a replacement for the renderer's authored depth rules. Mob combat remains authoritative over its normal runtime animation.
- **NPC & mob placement inspector** searches authored placement ID, kind and original template name. It can reveal placement/body/interaction/foothold geometry and authored hidden placements. NPC actions are non-authoritative artwork previews. Mob action overrides remain disabled; eligible NPC gameplay dialogue still requires the normal world interaction path.
- Each search accepts at most 120 input characters, scans at most 16,384 records, and materializes at most 200 dropdown options. Excess matches report the total and ask the user to refine the search; they are not silently presented as the complete result. Exceeding the record budget reports an explicit failure. Empty results disable entity mutation controls.
- A world-requested life selection resolves that exact placement, even if its ID is a prefix of many other IDs. It reveals **World**, the placement details, and geometry without routing metadata selection through NPC gameplay dialogue. The inspector is offline-only; the online console states that in the world section hint.
- Listener ownership remains explicit: Main owns static console navigation/theme listeners; `Controls.destroy()` aborts scene listeners; `LifeControls.destroy()` / `ProfileControls.destroy()` remove their handlers and roots.

## Local multiplayer simulation

The **Local multiplayer simulation** disclosure is an outside-game producer for real browser-local character records. It is not a simulated server connection. `LocalSimulationControls` exposes bounded character creation, explicit **Act as local character** and **Target local character** selectors, and the selected actor's domain actions.

- Social actions create actual local consent requests and atomically maintain reciprocal Buddy/Party/Guild/Alliance/Family/Messenger state. Receiving actions remain visible; opening a window never fabricates a roster.
- Peer trade actions invite/accept/decline, offer an actual owned UID/quantity, add mesos, confirm, chat or cancel through `LocalTrade`. The active character uses native UserInfo/TradingRoom; peer controls are not a shortcut around its acceptance surface.
- **Edit selected local peer** changes the selected non-active character's level (1–200, resetting EXP) or grants/removes validated item quantities through atomic local-profile transactions. Name/ID search spans the packaged catalog; removing an item selects its actual owned UID. These are explicit setup controls, not earned progression, a remote inventory protocol, or permission to mutate the active character through peer tools.
- Cash funding is explicitly GM setup. Selected-peer gift purchase spends its NX Prepaid through `CashShopService`; receipt claim consumes a real persisted gift envelope for the selected receiver. These controls neither switch the live profile nor synthesize a receipt.
- Local chat selects an actual sender/channel and reuses recipient, relationship, blacklist and permission admission. It does not invent All-chat delivery or a spouse.
- A pending action disables conflicting mutation and retains failure feedback. The native UI, atomic profile authority and resource preparation still own the result. Teardown removes subscriptions/listeners; no producer polls the profile every frame.

See [profile transactions](offline-profile.md#atomic-ownership), [native binding/domain contracts](offline-binding-actions.md) and the identity-scoped reports linked by [validation](validation.md). Seeded peer prerequisites and native active-character actions are reported separately.

## Agent experiments and record/replay

The **Agent** panel reuses the existing permission, stop, ownership and experiment controls. Permission is never inferred from theme, active section or profile state. Offline these controls drive the local session; online the underlying setup actions become audited server development requests and remain bound to the same explicit human-granted lease, so no new server authority or wire field is introduced.

Use the existing [`maple.agent` and `maple.dev.scenarios` workflow](agent-interface.md#temporary-scenarios-and-recording) for explicit agent command recording and replay. After a human grant and `maple.agent.acquire`, begin a scenario, immediately start recording, dispatch normal actions, advance up to eight30ms ticks per step, stop recording, and pass that recording to `run`. Exit restores the retained baseline. This command workflow remains distinct from the native error-diagnostic journal below; both use the existing world/scenario owners, not a second simulation.

Trusted human pointer/key input still revokes the agent lease before action handlers run. Exit remains usable after permission loss. Read-only paginated `maple.agent.observe` and `maple.dev.describe({entityId})` complement visible search without requiring a lease. Native diagnostic replay authorizes only the selected validated dump; it never grants an agent lease.

### Native Game Logs diagnostics

The in-game **Game Logs** window provides **Export JSON**, **Import**, and **Replay locally**. These are bounded local error diagnostics, not agent command-recording buttons or GM networking. Dumps include character/account/loaded-peer state, native UI and chat/drafts, field/physics/input/random state, offline/streaming context and exact source/assets/release identity; treat the downloaded file as private. Export is a browser JSON download, import is a selected local file, and nothing uploads.

`game-diagnostics.js` retains one initial field baseline and a finite journal of ordinary native handlers' inputs, accepted/refused agent commands and profile checkpoints. Captured native events cover pointer/carry, keys, wheel/scroll, focus, editor values/selections and paired IME composition. Events must be trusted; the sole composition exception accepts an untrusted `compositionend` only for the same target as a captured trusted start. Fixed owned roots and bounded data paths exclude links, password/file controls, Game Logs and agent controls; imported code, selectors, arbitrary property dispatch and prototype keys are not accepted.

Admission requires the exact same build/assets/release and recorded gameplay viewport. JSON is limited to16MiB, depth32 and262,144 nodes; the journal to8,192 events,4MiB and120,000 fixed30ms ticks. Missing/incomplete baselines, exhausted bounds or unsupported external state changes retain explicit non-replayable context rather than a fabricated replay. Browser focus/visibility or viewport changes invalidate recording or cancel replay; native pointer/key takeover, Escape and the visible Cancel control also cancel replay.

Replay creates memory-only profile/account/peer authorities while retaining and detaching the actual live scene, UI nodes, windows and drafts. It does not flush a dirty live baseline into IndexedDB on entry. Completion, cancellation and failure restore those retained owners, input, view, audio/pause state and UI preferences; temporary progress never replaces live or durable character/account state. Matching error signatures and compared authoritative state are reported separately from divergence. Browser tasks, asset/audio timing, wall time and UUID creation are external inputs, so an unreproduced error is not reported as deterministic success. See [validation](validation.md) for identity-scoped results and [validation method](validation-method.md) for procedures.

## Historical simplified-console native proof

The historical four-tab [console report](ingame-validation/console-simple/report.json) records its actual integrated browser, not a module fixture or the current dropdown layout. [Before](ingame-validation/console-simple/before.png), [Play](ingame-validation/console-simple/play-desktop.png), [Character draft](ingame-validation/console-simple/character-draft.png), and [390px/DPR2](ingame-validation/console-simple/play-mobile-dpr2.png) captures were inspected.

- Desktop rendered controls fell from 42 to 17 in the tested default view. The previous sidebar needed 2648px of scroll content; the final Play panel fits its 807px viewport without vertical overflow.
- Native edits survived tab switches and keyboard navigation. STR0 revealed/focused the collapsed Attributes field without changing live STR12. Wallet preview showed100000 while the live wallet stayed0; Discard preserved authority.
- HP51/maxHP50 rejected atomically and retained the name/HP draft. Correcting HP to50 committed; reload retained `LocalProof`/HP50. The disposable profile was restored to `Maple`.
- Native Music keyboard changes produced value1/readout1% and mute. Save checkpoint plus reload restored all three; the test restored volume64/unmuted afterward. This proves controls/settings, not speaker output.
- All three themes left the sampled native button's font, colors, radius and dimensions unchanged. Desktop hide/show changed canvas width1022→1440→1022. At390px and DPR1/2, all four tabs remained on one row with44px height and no horizontal overflow.
- Clicking the actual visible Blue Snail `life:10` revealed Inspect and selected that exact placement. Geometry references, entity search, camera centering/reset and30ms runtime stepping were exercised through their controls.
- Review found and fixed missing no-map disabling, late static navigation, and stale geometry-validator navigation. A held catalog request left moved controls disabled until map commit. A deliberately intercepted renderer-initialization rejection left Settings/offline actions reachable; this fault injection is not gameplay evidence.
- Manual replay found a sticky-toolbar hit interception: a scrolled camera button's center hit the Inspect tab instead. Independent panel scrolling now keeps the toolbar outside the clipping region; replay hit `entity-focus` and set camera(-353,-55)/follow=false.

That retained native validator and focused regression captures are linked in the report. Its historical strict lint and147 tests/876 assertions passed. That iteration introduced no new permanent UI tests, gameplay authority, save schema, or native-window styling; these statements do not describe the later schema8/native-diagnostic changes.

## Historical isolated-module proof

An isolated local browser harness loaded the actual source modules and stylesheet without rebuilding the project. The profile editor used the real `CharacterDevelopment` authority and `ProfileStore.memory`; scene/life API fixtures supplied bounded inspection records. This is console proof, not a full field playtest or an IndexedDB durability claim.

- Native mouse/select actions staged the 100,000-meso preset while the live wallet stayed 0; Apply committed the wallet to 100,000 and displayed saved feedback.
- Training preview staged AP20/SP10 while both live values stayed 0; Apply committed AP20 and SP pool0=10 through the same authority.
- Restore preview staged HP50/MP30 while the live values remained HP10/MP0. Discard returned the form to HP10 without mutation; preview plus Apply then committed HP50/MP30.
- A 250-entity snapshot showed exactly 200 options with an explicit refinement message. Searching `mob:249` reached its single option; Center camera called the existing API with `(498, 50)`. Empty search results disabled camera focus.
- A 250-placement life fixture likewise capped at 200. Searching the NPC name selected `life:249`; previewing its move action and showing geometry updated the selected fixture. A missing name disabled inspection and explained the empty result.
- All three themes changed only external chrome. A button probe beneath `.maple-ui-root` retained the same font, foreground, background and border radius across all themes. Reload restored Windows95 on both external roots.
- Screenshots were inspected at 1440×1100 and 390×844. At 390px the document and sidebar measured exactly 390px with no horizontal page overflow.

## Integrated native acceptance scenarios

The earlier [integrated item report](ingame-validation/expanded/items/evidence.json) retains native XP/95/Y2K selection,390px layout, unchanged native artwork/fonts, wallet preview/Apply and durable loot/pickup. The [windows report](ingame-validation/expanded/windows/report.json) proves temporary-profile Exit/reload and presentation restoration. These precede the simplified layout above. The following broader checklist does not imply that every preset/entity combination was exercised:

1. Load a field, open Inventory, Stats and Key Settings, then switch both console themes. Native raster artwork, control hit targets and chat typography must remain unchanged. Reload and confirm the selected console theme persists.
2. Preview and discard each preset, confirming native stats/wallet remain unchanged. Apply the wallet/training presets, confirm the native windows update, then reload to verify the durable commit. Exercise invalid values and profile/map ownership changes while saving; rejected edits must retain a usable draft.
3. Use World to search a late resident ID, toggle a harmless artwork preview, change its layer, center the camera, then restore Follow. Search no matches and verify mutation controls cannot run. Confirm native mob combat still owns its animation.
4. Search an NPC by original name in the placement inspector. Reveal geometry and inspect a preview, then use the NPC's world target for actual dialogue. A mob selection must never offer an action override or trigger NPC dialogue.
5. At390px width and with keyboard-only Tab/Enter navigation, reach theme selection, all five sections, preset Apply/Discard, World map selection, pause and diagnostics. Confirm default World, migration of persisted `field` to `world`, active-section state, Agent-only permissions and the transport toolbar above the sections. Scroll the console without losing access to the game.
6. Exercise the existing agent recording/replay sequence on the integrated build. Confirm trusted human takeover still revokes the lease, temporary profile progress cannot become a durable save, and Exit experiment restores the retained baseline under every theme. Separately exercise native Game Logs export/import/replay and cancellation with open windows and drafts; record restoration and any nondeterministic divergence rather than conflating that path with agent command recording.

`initialize()` owns the static navigation/theme abort signal before offline/renderer initialization; `destroy()` aborts it. Scene controls retain their own listener lifetime. Offline delivery mounts under **Settings** in `#offline-inspection > #offline-controls`; the online shell removes that host. Existing `onProfileEdit`, audio-setting storage and agent ownership/experiment interfaces remain unchanged.
