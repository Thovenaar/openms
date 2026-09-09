# Offline profile and character development

## Schema 4

`profile-validation.js` is the structural save authority. Schema 4 adds `remainingAp`, a nonnegative safe integer independent of the ten SP pools, and retains every schema-3 gameplay/keybinding field:

- `remainingSp`: exactly ten nonnegative safe integer pools.
- `skills`: at most 4096 canonical numeric-ID records `{ level, masterLevel, expiresAt }`. Learned rank and master rank are independent nonnegative safe integers; `level <= masterLevel` is not a universal invariant. Expiration is `null` or a nonnegative safe epoch-millisecond integer. The character/skill services check original catalog maxima and apply mastery only to the recovered gated books.
- `settings.chat`: original chat state 1–3 and integer expanded height 26–507. New profiles and v1/v2 migration use `{ state: 1, height: 70 }`, preserving both audio categories; v3 migration preserves existing chat preferences.

Original chat evidence: `008d4a6d` writes mode at `DAT_00bebf9c+0x54`, reads height at `+0x5c`, and uses 70 outside 26–507; native rendering adds 2 when height is divisible by 13. The UI handles that display adjustment rather than mutating the saved scalar during validation. See the retained [chat-mode consumer](ghidra-client-corrections/fidelity-chat-modes.txt).
Migration validates legacy root keys and all retained values. Version 1 receives the recovered default keybinding domain; version 2 receives ten zero SP pools, no learned skills and default chat preferences. Version 3 receives only `remainingAp: 0`. Earlier versions also receive zero AP. Existing bindings, inventory, equipment, quests, coordinates, settings and stats are preserved, including version-3 SP and learned/master/expiration records. Corrupt and future schemas are rejected. Migration grants no ranks, points, levels or job gifts. Inventory/equipment remain their previous schema; slot migration is separate.

Ten pools and learned/master/expiration records use the authorized Cosmic GMSv83 emulator as a server-reference model (`AbstractCharacterObject`, `AssignSPProcessor`, `Character`); they are not a claim of original Nexon server source. Original Skill.wz supplies book identities, rank fields, maxima and prerequisites. No Windows runtime reference is available.

AP/SP separation is server data semantics, not a recovered client allocation rule; [minimap/AP provenance](ghidra-client-corrections/minimap-provenance.json) retains the reference. Stat displays saved AP at the native right edge85,y215 when the beginner notice is absent. Normal AP spending and advancement grants remain unavailable even with a positive edited balance. Direct sidebar changes to AP or primary stats are explicit local development policy.

## Atomic ownership

The durable and temporary memory implementations live together in `profile-store.js`: `ProfileStore.memory(profile)` does not open IndexedDB. `await store.commitProfile(transform)` accepts a synchronous transform of an isolated mutable draft; the transform returns nothing. The whole resulting profile is validated and cloned again, so a caller retaining the draft cannot mutate the persisted or published candidate.

The transaction is single-flight. A concurrent profile edit or binding save rejects `save-busy`; the accepted operation waits for an earlier flush. Later flush, reset and teardown operations drain the accepted transaction through the existing operation promises. `commitKeyBindings` uses this same path. Durable writes retain strict IndexedDB transaction completion, revision/generation compare-and-swap, timeout/abort handling and cross-tab conflict rejection. A failed transform, validation or durable write cannot publish its candidate. Success publishes all fields together in one notification. Failure restores an equal mutable profile before reporting the error; save revision is not advanced by validation failure.

`store.profileTransactionPending` is synchronous from acceptance until completion. The current **plain** profile graph is bounded-deep-frozen during this interval: previously obtained nested references cannot bypass exclusion, and `structuredClone(store.profile)` remains supported. Success installs the isolated mutable candidate; failure installs an equal mutable clone of the prior profile. Callers must reacquire `store.profile` after **every atomic transition**, including failures; old root/nested references remain frozen. Do not retain a profile root inside a long-lived name renderer or service.

### Required integration gates

Before mutations—not merely at the subsequent `markDirty` call—Main excludes physics/field/mob/reactor authority, location/settings checkpoints, item/quest/skill actions, map/scenario replacement and reset admission while `profileTransactionPending`. Rendering and inspection remain live. Elapsed wall time while paused must not become later physics catch-up. Audio controls may change audio-owned settings, but checkpointing them into the profile waits until the lock is released. Ordinary synchronous gameplay keeps the existing `markDirty` API outside transactions. Frozen data is the fail-before-mutation backstop, not a replacement for usable input admission.

## Persistent development service

`new CharacterDevelopment(store, catalog)` exposes `await edit(patch)`. Only name, level, job, EXP, HP/MP and maxima, STR/DEX/INT/LUK, meso, fame, AP, ten SP pools and learned records are editable. The patch is snapshotted before waiting. Validation includes nonnegative safe-integer AP, HP/MP maxima, level 1–200, EXP below `experienceRequired(level)` (or zero at level 200), original job membership from `catalog.ui.coverage.skillCoverage.playerBooks`, and each record's learned/master rank within `catalog.ui.skills[id].maxLevel`.

Job changes retain learned records; availability is separately derived by the skill owner. No AP/SP/job gifts or destructive rank normalization occur. EXP thresholds still use the explicitly provisional offline progression policy, not a newly recovered original EXP table. Persistent development editing is separate from agent sandbox editing.

`InGameSystems` wires `owner.hooks.onProfileEdit(patch)` to this service and `owner.hooks.onLearnSkill(id)` to normal skill allocation. The persistent **Edit character** form uses typed native browser controls in the inspection sidebar, outside the original raster gameplay plane: name text, integer scalar inputs including AP, a catalog-backed job selector, ten labeled SP pools, and advanced learned-record add/remove/rank/master/expiry controls. Blank expiry means `null` (permanent); numeric expiry is epoch milliseconds. **Save changes** commits only changed fields together; **Discard unsaved edits** restores the current profile projection. Unsaved form values survive unrelated profile refreshes. Pending edits disable mutation controls and expose saving/error status. These are explicit local development controls, not a recovered original character-editing feature.

Normal learning remains in the Skill window and spends the applicable points through `SkillSystem`; editing a learned record is not normal allocation. Learned skill carry uses `owner.beginBindingDrag(event, { type: 1, id }, null, { source: layer, path: template.iconPath })`, with the leased UI surface as its source. Catalog visibility does not imply learned ownership or an available cast controller.

## Executed verification and limits

The [current native-input report](ingame-validation/interaction-corrections/report.json) covers schema4 AP5 in the original Stat counter, persistent typed edits, job/book synchronization, learned/master/expiry edits, and atomic rejection of HP301/maxHP300 with an unrelated name edit left unpublished. Native prerequisite learning, mastery-gated allocation and SP exhaustion refreshed the editor and Skill window coherently. Final source gates passed **140 tests /822 assertions**, strict lint and extraction; migration boundaries are regression-test evidence, not a new browser migration matrix.

The earlier schema-3 integrated source passed strict lint and 128 tests / 751 assertions. Its retained profile-transaction and character-development regressions cover coherent publication, retained-draft isolation, failure restoration, pending-write rejection, flush/teardown ordering, migration preservation, caps and invalid edits. Those totals are historical, not acceptance of schema4 or the current editor.

In that earlier native pass, form edits to name, job, level, vitals, meso, fame and SP committed to IndexedDB and survived reload. An HP 101 / maxHP 100 edit was rejected without partial publication. Native Skill-window learning of HP Recovery and Power Strike spent SP 10→9→8 and both learned ranks survived reload. The [retained fidelity report](ingame-validation/fidelity/report.json) records that scope, not browser acceptance of the later AP/editor correction.

Neither pass establishes every field/value combination, every pending-operation gate or a fresh cross-tab CAS scenario. Earlier concurrency evidence is explicitly historical in [offline-saves.md](offline-saves.md#executed-verification). No Windows-runtime comparison or complete native-fidelity claim follows from these results.
