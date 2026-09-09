# Offline character persistence

## Scope and source boundary

`client/src/profile-store.js` owns one local character in IndexedDB. `profile-validation.js` owns schema4 validation, explicit v1/v2/v3 migration and the local beginner preset; `keymap.js` supplies recovered bindings. Neither persistence module owns gameplay, rendering or server operations. This is a browser format, not a native save file. [Profile/development contracts](offline-profile.md) define AP, SP, learned records, chat settings and atomic edits.

Discovery source: `offline-gameplay-discovery-7`. Original material remains unchanged:

- `docs/ingame-inventory/Etc.tar.gz:MakeCharInfo.img.json`, `Info/CharMale`, lists coats including 1040002, pants including 1060002, shoes including 1072001, and weapons 1302000/1322005/1312004. These are selectable original templates, **not evidence of automatic character-creation grants**. The browser preset deliberately equips 1040002, 1060002, 1072001, 1302000. It does not invent starting consumables.
- `docs/ingame-inventory/Character.tar.gz` retains the original equipment template metadata: coat slot Ma, pants Pn, shoes So, and corresponding requirements/bonuses. Saved equipment contains template IDs, not fabricated individual item-instance statistics.
- Original field-entry consumers at executable addresses `0094969a`/`0094969d` place arrivals at portal y minus 10. The persistence module does not infer geometry: Main supplies a validated packaged spawn as `open({location:{mapId,x,y,facing}})` for creation/reset and validates restored coordinates against the loaded field.
- Original HUD strings at `00b285e0` (HP), `00b285d0` (MP), `00b285c4` (Level), and `00b28ad8` (StatusBar resource) establish consumers, not new-character values. Name Maple, level 1, job 0, EXP/meso/fame 0, HP 50, MP 30, STR 12, DEX 5, INT/LUK 4 are the shared **provisional local policy**.
- Original `Sound_DX8` attenuation consumer `5180c8a7` supplies the separately implemented audio gain mapping. Saved BGM/SE volume 64 and mute false are explicit browser starting preferences, not recovered original defaults.

No original migration or durable store was recovered. Browser-format migration validates each legacy profile, adds default bindings for v1, adds empty learned records, ten zero SP pools and chat settings for v1/v2, and supplies zero AP to all pre-v4 records. Version3 preserves its existing SP, skills and chat preferences. Existing character/inventory/quest/audio state is preserved; no skills, points or advancement gifts are granted. Corrupt/future records never silently become a fresh character.

## API and ownership

```js
const store = await ProfileStore.open({ location: packagedSpawn });
if (store.error) {
  // Show store.error.message; gameplay must not start with profile === null.
}
const unsubscribe = store.subscribe((changedStore) => {
  // Read changedStore.snapshot() for persistence UI; profile for gameplay projections.
});
store.profile.meso += earnedMeso;
store.markDirty();
await store.flush();
unsubscribe();
await store.destroy();
```

- `ProfileStore.open({location} = {})` returns a store even on a storage/load failure. `.profile` is null until a complete profile has been accepted; `.error` is a `ProfileError` with a stable `.code` and visible `.message`. Opening an existing valid profile does not require a bootstrap location. Creating/resetting without one fails with `missing-bootstrap`; there is no guessed map or `(0,0)` fallback.
- `.profile` exposes the current mutable root. Ordinary synchronous gameplay finishes related mutations before `.markDirty()`. Atomic profile/binding commits freeze the old graph and replace the root on success **or failure**; consumers must reacquire it after every transition. No long-lived service may cache root/nested references across replacement. Consumers cannot assign the root themselves.
- `.markDirty()` advances `dirtyEpoch`, notifies observers and schedules one coalesced 250-ms checkpoint. It does not clone or validate the whole profile in a physics tick. Any synchronous gameplay operation must finish all its related mutations before returning to the browser event loop.
- `.flush()` clears the pending timer and returns a shared promise for overlapping calls. A call advances the requested epoch barrier; it does not enqueue an independent stale copy. Every committed snapshot is a validated structured clone of **all** character, inventory, equipment, quest, location, settings and committed key-binding fields. Mutations made after capture remain dirty. Subsequent overlapping flush calls advance the barrier and trigger a further transaction before the shared promise resolves. The bounded catch-up limit is64 transactions per flush cycle; overload is explicit.
- `.reset()` is an explicit destructive action, not automatic recovery. It waits for an in-flight flush, then performs one compare-and-replace transaction. Only after that transaction commits does it update the existing root in place (or supply a root when a corrupt profile could not load). Reset deliberately supersedes in-memory mutations made before its commit. It resets every domain together and rotates the save generation. A stale tab cannot reset over another tab's newer commit. The UI/Main must reload the bootstrap field after awaiting reset, rather than reusing stale scene or nested-state references.
- `.snapshot()` returns persistence metadata, including status/revision/generation, dirty epochs, `profileTransactionPending`, persistence kind and an explicit error—not character data. Gameplay reads `.profile`; bounded agent observations and explicit development operations provide detached views.
- `.subscribe(listener)` returns an unsubscribe function. The bounded set permits 64 observers. Callbacks receive the store and should be observational. Observer failures are reported separately and do not turn a committed save into a failed transaction.
- `.destroy()` is asynchronous and must be awaited/caught. It performs the final flush, removes owned pagehide/visibility listeners, closes BroadcastChannel and IndexedDB, and releases observers even when the flush rejects. Main owns taking the final position/settings checkpoint **before** flushing/teardown.
- `.commitProfile(transform)` owns a synchronous transform of an isolated draft, validates/clones it and publishes only after durable completion. `profileTransactionPending` excludes other mutations throughout. `.commitKeyBindings(value)` uses this same transaction; the live KeyConfig draft remains separate until Save. See [atomic ownership](offline-profile.md#atomic-ownership) for failure restoration and lifetime rules.

## Durable record and concurrency

Database: `maple-offline-save`, physical IDB version 1. Object store: `profiles`, key path `id`, singleton key `local`.

The envelope is `{id,generation,revision,createdAt,updatedAt,profile}`. `profile.schemaVersion` is **4**, independent of physical IDB version1. Creation/reset chooses a new generation UUID; normal commits advance revision without changing generation. Reset may restart an exhausted revision only because its generation changes, preventing reuse of an old comparison token.

Read/check/write occur in the same `readwrite` transaction with `durability: "strict"`. Success is published only from transaction completion, never request success. The transaction compares both expected revision and expected generation before putting the complete next record. Invalid existing envelopes cannot be overwritten by normal saves. Explicit reset may replace a malformed/future profile only if its loaded comparison token still matches. A corrupt generation/revision token is normalized solely for reset comparison; the replacement receives a fresh valid generation. There is no delete-then-create interval, second copy of inventory, separate quest write, or reward replay queue.

Only transaction `oncomplete`/`onabort` settle the durable outcome. If a timeout tries to abort an already finished transaction and receives `InvalidStateError`, the queued terminal event decides the result: a committed write advances revision instead of being falsely reported as failed. A successful timeout abort still reports `storage-timeout`; no retry or fabricated success is added.

Quest completion and its rewards therefore persist together when their synchronous caller mutates them together. Loading the resulting completed quest cannot reload a pre-reward state or apply a reward again merely because flush was called rapidly. Semantic duplicate-command prevention still belongs to the quest authority's completed-state check, not to an invented persistence receipt protocol.

BroadcastChannel publishes only `{id,revision,generation}` hints. A foreign newer/different-generation hint immediately exposes a conflict; it never supplies trusted replacement profile data. IDB transactional comparisons prevent stale overwrite even if BroadcastChannel is absent. A conflicting tab retains its local profile and error for inspection but must reload to accept the durable winner. It does not silently merge, auto-reload, or overwrite. Failed checkpoints stop automatic retries; explicit flush can retry a transient failure, while the same revision/generation comparison still protects conflicts.

## Validation and failure behavior

The exact shared schema is validated at both load and checkpoint boundaries, including unknown fields, schema version, safe integer counters, nonnegative quantities, HP/MP maxima, finite coordinates, facing, unique inventory/equipment IDs, numeric quest/kill keys, and audio volume 0–128 with boolean mute. Collection bounds are browser engineering policies: 4096 inventory entries, 128 equipment IDs, 16384 quests, 4096 kill targets per quest and 65536 targets total. Coordinates are bounded to magnitude 10000000; map IDs are nine-digit strings. These are not recovered gameplay caps.

`profile.keyBindings` is `{keys:[{type,id}], quickSlots:[keyIndex]}`: exactly89 type0–8/uint32 records, including valid assigned type4/ID0, and exactly eight unique assignable physical-key indices. Right Shift's duplicate index54 is rejected in persisted quick slots; runtime canonicalizes right modifiers. Fresh profiles and migrated v1 profiles receive `createDefaultBindings()`. An open KeyConfig owns a separate live draft: Default/Delete/placement changes are not durable until parent OK or the dirty-close **Save changes?** affirmative action succeeds. Its nested quick-key popup owns an isolated draft; popup OK publishes only to the parent draft, and popup Cancel discards it. See [UI input contract](ingame-ui.md#key-draft-quick-slots-chat-and-cursor).

`remainingAp` is a nonnegative safe integer, independent of `remainingSp`'s exactly ten nonnegative safe-integer pools. `skills` contains at most 4096 canonical numeric IDs, each with `{level, masterLevel, expiresAt}`. Learned and master ranks are independent nonnegative safe integers; only catalog-aware mastery-gated books cap allocation by master rank. `expiresAt` is required and is either `null` or a nonnegative safe epoch-millisecond integer. `settings.chat` preserves state1–3 and integer expanded height26–507 alongside both audio categories. Structural and catalog-aware validation are separate; see [schema4 and the character editor](offline-profile.md).

Recovery consumption mutates HP/MP and one owned inventory count together, removes a zero-count stack, then marks dirty and requests a flush. All input paths share `ItemUse`'s inclusive200ms admission interval; full vitals still consume an otherwise supported item. The throttle timestamp is transient, not a durable countdown. A save failure reports that the accepted local consumption remains unsaved; it does not fabricate server rejection or reverse only one field. Unsupported effects/restrictions fail closed before mutation.

Malformed v1/v2/v3/v4 data produces `corrupt-profile`; versions above4 produce `future-profile-version`; unsupported older/missing schemas require migration. Valid v1/v2/v3 records migrate explicitly. Corrupt/future records stay unchanged until an explicit reset commits. Higher physical database versions fail without deletion. Opening is bounded to10 seconds and transactions to15 seconds; storage, abort, quota, timeout and concurrency errors remain visible. Version changes close the connection and require reload rather than holding an upgrade hostage.

Pagehide/hidden-tab flushing is best effort: browsers may terminate the page before an asynchronous IDB transaction finishes. The periodic checkpoint and explicit Save button are the persistence guarantees available to this client; durable transactions do not promise survival of browser site-data deletion, storage eviction, private-session expiry or device failure. No asset cache is evicted to make a profile save appear successful.

## Executed verification

The [current native-input report](ingame-validation/interaction-corrections/report.json) verifies AP/editor persistence, key/quick-slot durable save and outer discard, a rejected keybinding write preserving the committed baseline, and real item/meso pickup across reload. One injected IndexedDB quota failure left both ground drops and the profile unchanged; retry credited one Green Apple, and a later pickup credited9 mesos exactly once. Meso-capacity refusal retained the drop without marking storage failed. Final regression gates passed140 tests/822 assertions; this does not repeat the historical cross-tab or complete-release installation matrix.

The earlier schema-3 integrated source passed strict lint and 128 tests / 751 assertions. Native browser character-editor changes to name, job, level, vitals, meso, fame and SP committed to IndexedDB and survived reload; HP 101 / maxHP 100 was rejected without partial publication. Normal Skill-window learning persisted HP Recovery and Power Strike with SP 10→9→8 across reload. See the [retained fidelity report](ingame-validation/fidelity/report.json) for that scope. These historical observations do not establish browser acceptance of schema4, AP migration or the current editor.

The following browser artifacts predate schema 2 and the graphical/input correction. They establish the earlier whole-profile/concurrency baseline, **not** current migration, binding-draft persistence or item-use acceptance. Earlier graphical proof is also indexed in [graphical UI/input acceptance](ingame-ui.md#graphical-ui-input-acceptance).

[Native Chromium IndexedDB evidence](offline-save-validation.json) records all profile domains surviving close/reopen, overlapping dirty checkpoints, a rejected stale writer preserving the durable winner, reset retaining the live root while rotating generation, and corrupt/future profiles remaining unchanged until explicit reset. This used the real store and browser database, not storage mocks.

[Independent gameplay evidence](offline-validation/combat-quests/evidence.json) records Camila completion/reward and subsequent reload. Main reopened the completed quest through the native [journal](offline-validation/main/journal-after.json) and [detail](offline-validation/main/journal-detail-after.json): 30/30 Pigs, EXP600 and disabled duplicate completion. [Server-stopped offline portal/reload](offline-validation/main/server-stopped-portal-reload.json) records an exact full-profile match after native travel, Save locally and reload.

Unavailable/blocked storage, physical database upgrades, transaction timeout and device/site-data loss are explicit implementation boundaries, not all claimed as fault-injected browser scenarios in this pass.
