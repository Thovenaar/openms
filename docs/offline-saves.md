# Offline character persistence

## Scope and source boundary

`client/src/profile-store.js` owns one local character in IndexedDB. `profile-validation.js` owns schema-1 validation and the explicit local beginner preset. Neither module imports gameplay, rendering, asset loaders, CacheStorage, WZ resources, or server code. Existing asset caches are untouched. This format is a browser policy, not a recovered native save file or server protocol.

Discovery source: `offline-gameplay-discovery-7`. Original material remains unchanged:

- `docs/ingame-inventory/Etc.tar.gz:MakeCharInfo.img.json`, `Info/CharMale`, lists coats including 1040002, pants including 1060002, shoes including 1072001, and weapons 1302000/1322005/1312004. These are selectable original templates, **not evidence of automatic character-creation grants**. The browser preset deliberately equips 1040002, 1060002, 1072001, 1302000. It does not invent starting consumables.
- `docs/ingame-inventory/Character.tar.gz` retains the original equipment template metadata: coat slot Ma, pants Pn, shoes So, and corresponding requirements/bonuses. Saved equipment contains template IDs, not fabricated individual item-instance statistics.
- Original field-entry consumers at executable addresses `0094969a`/`0094969d` place arrivals at portal y minus 10. The persistence module does not infer geometry: Main supplies a validated packaged spawn as `open({location:{mapId,x,y,facing}})` for creation/reset and validates restored coordinates against the loaded field.
- Original HUD strings at `00b285e0` (HP), `00b285d0` (MP), `00b285c4` (Level), and `00b28ad8` (StatusBar resource) establish consumers, not new-character values. Name Maple, level 1, job 0, EXP/meso/fame 0, HP 50, MP 30, STR 12, DEX 5, INT/LUK 4 are the shared **provisional local policy**.
- Original `Sound_DX8` attenuation consumer `5180c8a7` supplies the separately implemented audio gain mapping. Saved BGM/SE volume 64 and mute false are explicit browser starting preferences, not recovered original defaults.

No original migration rules or durable profile store were recovered. Consequently there is no guessed migration, no silent downgrade and no catch-and-start-over path.

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
- `.profile` is a getter exposing the sole mutable root. All gameplay mutations are synchronous on the browser JS thread, followed by `.markDirty()`. The reference is stable across successful resets of an existing profile. Root replacement by consumers is not allowed. Nested inventory, quest, settings and location references are replaced on reset and must not be cached across that boundary.
- `.markDirty()` advances `dirtyEpoch`, notifies observers and schedules one coalesced 250-ms checkpoint. It does not clone or validate the whole profile in a physics tick. Any synchronous gameplay operation must finish all its related mutations before returning to the browser event loop.
- `.flush()` clears the pending timer and returns a shared promise for overlapping calls. A call advances the requested epoch barrier; it does not enqueue an independent stale copy. Every committed snapshot is a validated structured clone of **all** character, inventory, equipment, quest, location and settings fields. Mutations made after capture remain dirty. Subsequent overlapping flush calls advance the barrier and trigger a further transaction before the shared promise resolves. The bounded catch-up limit is 64 transactions per flush cycle; overload is explicit.
- `.reset()` is an explicit destructive action, not automatic recovery. It waits for an in-flight flush, then performs one compare-and-replace transaction. Only after that transaction commits does it update the existing root in place (or supply a root when a corrupt profile could not load). Reset deliberately supersedes in-memory mutations made before its commit. It resets every domain together and rotates the save generation. A stale tab cannot reset over another tab's newer commit. The UI/Main must reload the bootstrap field after awaiting reset, rather than reusing stale scene or nested-state references.
- `.snapshot()` returns persistence metadata only: `{status, revision, generation, dirty, dirtyEpoch, savedEpoch, error}`. `error` is null or `{code,message}`. Status is `opening`, `saved`, `dirty`, `saving`, `resetting`, `conflict`, `error`, or `closed`. Gameplay data remains at `.profile`; inspection can clone it separately outside the tick when required.
- `.subscribe(listener)` returns an unsubscribe function. The bounded set permits 64 observers. Callbacks receive the store and should be observational. Observer failures are reported separately and do not turn a committed save into a failed transaction.
- `.destroy()` is asynchronous and must be awaited/caught. It performs the final flush, removes owned pagehide/visibility listeners, closes BroadcastChannel and IndexedDB, and releases observers even when the flush rejects. Main owns taking the final position/settings checkpoint **before** flushing/teardown.

## Durable record and concurrency

Database: `maple-offline-save`, physical IDB version 1. Object store: `profiles`, key path `id`, singleton key `local`.

The envelope is `{id, generation, revision, createdAt, updatedAt, profile}`. `profile.schemaVersion` is 1 and independent of the physical IDB version. `generation` is a random UUID generated on creation and every explicit reset. Normal saves increase the nonnegative safe-integer revision while retaining generation. Reset normally increases revision too; at revision exhaustion it can safely return to zero because generation changes. This prevents an old writer from matching a reused revision after resetting a malformed envelope.

Read/check/write occur in the same `readwrite` transaction with `durability: "strict"`. Success is published only from transaction completion, never request success. The transaction compares both expected revision and expected generation before putting the complete next record. Invalid existing envelopes cannot be overwritten by normal saves. Explicit reset may replace a malformed/future profile only if its loaded comparison token still matches. A corrupt generation/revision token is normalized solely for reset comparison; the replacement receives a fresh valid generation. There is no delete-then-create interval, second copy of inventory, separate quest write, or reward replay queue.

Quest completion and its rewards therefore persist together when their synchronous caller mutates them together. Loading the resulting completed quest cannot reload a pre-reward state or apply a reward again merely because flush was called rapidly. Semantic duplicate-command prevention still belongs to the quest authority's completed-state check, not to an invented persistence receipt protocol.

BroadcastChannel publishes only `{id,revision,generation}` hints. A foreign newer/different-generation hint immediately exposes a conflict; it never supplies trusted replacement profile data. IDB transactional comparisons prevent stale overwrite even if BroadcastChannel is absent. A conflicting tab retains its local profile and error for inspection but must reload to accept the durable winner. It does not silently merge, auto-reload, or overwrite. Failed checkpoints stop automatic retries; explicit flush can retry a transient failure, while the same revision/generation comparison still protects conflicts.

## Validation and failure behavior

The exact shared schema is validated at both load and checkpoint boundaries, including unknown fields, schema version, safe integer counters, nonnegative quantities, HP/MP maxima, finite coordinates, facing, unique inventory/equipment IDs, numeric quest/kill keys, and audio volume 0–128 with boolean mute. Collection bounds are browser engineering policies: 4096 inventory entries, 128 equipment IDs, 16384 quests, 4096 kill targets per quest and 65536 targets total. Coordinates are bounded to magnitude 10000000; map IDs are nine-digit strings. These are not recovered gameplay caps.

Corrupt schema-1 data produces `corrupt-profile`; a higher profile schema produces `future-profile-version`; lower/missing schema produces `migration-required`. Original data remains in IndexedDB unchanged until an explicitly requested reset successfully commits. A higher physical database version fails visibly as `future-database-version`, without deleting it. Blocked opening, unavailable storage, quota, abort, timeout, unexpected close and version changes have explicit error codes/messages. Opening is bounded to 10 seconds and transactions to 15 seconds. A version-change notification closes the old connection and requires reload rather than holding an upgrade hostage.

Pagehide/hidden-tab flushing is best effort: browsers may terminate the page before an asynchronous IDB transaction finishes. The periodic checkpoint and explicit Save button are the persistence guarantees available to this client; durable transactions do not promise survival of browser site-data deletion, storage eviction, private-session expiry or device failure. No asset cache is evicted to make a profile save appear successful.

## Executed verification

[Native Chromium IndexedDB evidence](offline-save-validation.json) records all profile domains surviving close/reopen, overlapping dirty checkpoints, a rejected stale writer preserving the durable winner, reset retaining the live root while rotating generation, and corrupt/future profiles remaining unchanged until explicit reset. This used the real store and browser database, not storage mocks.

[Independent gameplay evidence](offline-validation/combat-quests/evidence.json) records Camila completion/reward and subsequent reload. Main reopened the completed quest through the native [journal](offline-validation/main/journal-after.json) and [detail](offline-validation/main/journal-detail-after.json): 30/30 Pigs, EXP600 and disabled duplicate completion. [Server-stopped offline portal/reload](offline-validation/main/server-stopped-portal-reload.json) records an exact full-profile match after native travel, Save locally and reload.

Unavailable/blocked storage, physical database upgrades, transaction timeout and device/site-data loss are explicit implementation boundaries, not all claimed as fault-injected browser scenarios in this pass.
