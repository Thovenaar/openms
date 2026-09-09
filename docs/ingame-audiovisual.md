# In-game audiovisual reconstruction

## Provenance and scope

Only `/Users/k/Development/tensorfish/Maplestory-Client` original WZ archives and the original unpacked executable/retained DLL decompilation were used. There is no original source, recording, Windows runtime or server. This implementation does **not** establish original visual/audio parity.

Implemented files:

- `client/tools/audiovisual-data.js`: shared-context extraction of exact MP3 payloads, original sound envelopes, map BGM binding and separate effect bundles.
- `client/src/audiovisual-system.js`: committed-scene BGM selection, exact UI/Game sound dispatch, bounded reconstruction controls and one-shot effect inspection.
- `client/src/audio-engine.js`: native decoding, original backend volume curve, bounded PCM ownership and actual output graph.
- `client/src/audio-capture-worklet.js`: pass-through stereo capture after both master gains, before the actual destination.

No fixed-30-ms physics, package-v2 map/region or atlas implementation was changed by this domain.

## Recovered original consumers

Fresh decompilation ran with installed Ghidra `analyzeHeadless`, `docs/tools/clientFocus.java` and the isolated `/tmp/maple-ingame-audiovisual.gpr` project, program `Maplestory_UNPACKED.exe`. Retained outputs:

- [consumers.c](ghidra-ingame-audiovisual/consumers.c): all eight assigned priority addresses.
- [lifecycle.c](ghidra-ingame-audiovisual/lifecycle.c): BGM factory `0043f301` and setting-range reader `0049ef65`.
- [ownership.c](ghidra-ingame-audiovisual/ownership.c): sound dispatch/cache, BGM equality and effect owner creation.
- [settings.c](ghidra-ingame-audiovisual/settings.c): effect loader chain and one-shot ownership queue.
- [original selected strings](ghidra-ingame-audiovisual/selected-strings.json), [PUSH-ID references](ghidra-ingame-audiovisual/string-refs.txt).

Concrete recovered behavior:

1. `0064211e` reads map `bgm`, prefixes `Sound/`, and calls `0043f301` with loop argument `1` and transition argument `600`. `0043f301` returns early for the same path through `0043f66c`, which compares strings. Its sound start argument becomes `-1` for the looping case. [Sound_DX8 `5180c20d`](ghidra-assets/Sound_DX8.dll/decompiled.c) recognizes playback state `-1` and requests DirectSound looping. Same-original-path BGM retains the browser source and playback position.
2. Exact UI dispatch `00989588` prefixes `Sound/UI.img/` and calls `0043fb25(path,100,0)`. The separate `009895eb` variant passes `1` rather than `0`; it is not conflated with ordinary UI one-shots. `009899b1` prefixes `Sound/Game.img/` and forwards a caller-provided parameter. `0043fb25` caches/instantiates sound objects and selects one playback versus `-1` looping from that final flag. Browser `playSound` exposes the ordinary one-shot path, not the retained-loop variant or arbitrary original priorities.
3. `0049c441` reads `soBGMVol`/`soSEVol` with default 15 and bounds 0..19; mutes default to 0. `0049c8e7` persists those settings. The conversion between this original settings slider and backend 0..128 volume is **not recovered**. The reconstruction controls deliberately expose **backend volume**, initially 64 as a browser preference, not a fabricated original default.
4. [Sound_DX8 `5180c8a7`](ghidra-assets/Sound_DX8.dll/decompiled.c) maps backend `v < 1` to `-10000`, `1..127` to `625 - trunc(1280000 / (15*v+128))`, and `v >= 128` to 0 hundredths of a decibel. Runtime gain is `10^(attenuation/2000)`; explicit mute gives zero. BGM and SE have separate gains and mutes.
5. `009377d9` is a byte-selected event dispatcher; case 0 resolves LevelUp visual and invokes the Game sound dispatcher. Other selected original effect resource paths are retained in its body. These are not locally inferred player statistics or server events.
6. `00439750` loads through `0043e86f -> 0043ea3e`, invokes layer `+0x110` with mode 0 and retains an owner through `00435d6f`. The loader joins `0043f768`, whose [default delay is 120 ms](ghidra-client/frame-alpha.txt#L47). This now proves omitted effect-frame delay; it is not justified by the older extractor's coincidental 120-ms policy. Explicit numeric-string delays normalize to numbers. Original alpha endpoints and origin-aware texture parts are retained; existing `EntityAnimation` supplies the recovered integer alpha interpolation.
7. `00529ef2` reads map `effect` and formats `Effect/MapEff.img/%s` into a retained field. Map 230000000 authors `Bubbling`; it is not `Map.wz:Effect.img`. The automatic emission location, cadence and trigger consumer remain unresolved. Runtime therefore offers **Preview map effect**, using a plainly local position at the avatar's current feet. It does not invent original underwater breathing/particle behavior.

## Packaged resources

`extractAudiovisual(context,mapIds,weaponSfx)` returns JSON-compatible schema version1. `weaponSfx` comes from the actually selected original equipment metadata:

- `maps[mapId] = {bgm, effect}`. `bgm` is a standard immutable resource descriptor plus `source`, `encoding:85`, original `channels`, original `sampleRate`, `durationMs` and full `envelope` (including original GUIDs, field30, field34, sampleSize, formatFlags and exact formatData hex).
- `sounds.UI[name]` and `sounds.Game[name]` have the same sound descriptor shape. Names are original case-sensitive root node names, not aliases. There are 31 UI and 27 Game nodes in the supplied installation.
- `effects[name] = {bundle,source,timingSupported:true,activation:"local-preview-only",durationMs}`. `bundle` is the shared immutable visual bundle descriptor. One EntityAnimation entity, `kind:"effect"`, action `play`, is included. No new Frame extension fields are introduced.
- `combat.digits` is a shared visual bundle for the original NoRed/NoBlue/NoViolet/NoCri banks.
- `combat.sounds.Mob[id][name]` and `.Weapon[weaponSfx][name]` are `{available:true,descriptor}` or `{available:false,source,alias,reason}`. Projection includes only current consumers: Damage/Die, Attack1–8, CharDam1/2, and the equipped weapon's Attack. Unresolved original UOLs are preserved as explicit unavailability; no case folding, path repair, substitute sample or swallowed publication error is introduced. An attempted unavailable event reports its source/reason. Absent authored nodes remain absent.

All original MP3 bytes are published unchanged at content-hashed `/generated/audio/<sha256>.mp3` URLs with the shared `resource()` publisher. Same tracks and duplicate UI/Game payloads retain identical hashes. Sound format validation rejects unknown envelopes and non-MP3 encodings explicitly; there is no guessed decode or transcoding fallback.

The eight original acceptance seeds have these BGM bindings; the default named-route closure packages356 maps:

| Map       | Original Sound.wz resource | Original duration ms |
| --------- | -------------------------- | -------------------: |
| 100000000 | Bgm00.img/FloralLife       |               137639 |
| 100000001 | Bgm00.img/FloralLife       |               137639 |
| 103040000 | Bgm21.img/KerningSquare    |               182465 |
| 108000500 | Bgm15.img/inNautilus       |               152084 |
| 120000000 | Bgm15.img/Nautilus         |               122279 |
| 200090500 | Bgm13.img/Leafre           |               157231 |
| 211040000 | Bgm04.img/WarmRegard       |               168124 |
| 230000000 | Bgm11.img/Aquarium         |               145319 |

Effects: BasicEff `Teleport`, `LevelUp`, `JobChanged`, `QuestClear`, `ItemLevelUp`, `IncEXP`, `Transform`, `TransformOnLadder`, `Flying`, `Flying1`; MapEff `Bubbling`, `Viewrange`, `NpcSummon`, `NpcReturn`. Every preview plays one original sequence then releases its display object and bundle lease. Bubbling's explicit frame delays are 100,100,100,100,400 ms. LevelUp uses the now-proved omitted-delay fallback. No server event, character statistics, inventory, NPC interaction or combat result is modified by previews. Preview UI placement and starting position are browser inspection policy, not original event positioning.

## Runtime integration

Use the assigned API: construct `new AudiovisualSystem(app,services,{onError})`; await `prepare(catalog.audiovisual,signal)`; call `setScene(scene)` only after an atomic committed scene replacement, `update(elapsedMs)` per render and `destroy()` at teardown. `services` are shared `{network,atlases}`. `scene.overlays` must be a persistent world-space container surviving region refresh; preview displays are attached there and removed before their resource owner is destroyed.

Additional public APIs:

- `await playSound("UI"|"Game", originalName)` returns `{status:"playing",source}` or explicit `{status:"gesture-required"}`. Errors/cancellation reject. Callers attach error handling. No event is queued for surprise playback after later enabling audio.
- `await previewEffect(originalName)` is expressly non-authoritative and loads only that bundle. One preview/loading request is owned at a time; new requests/maps abort old loads.
- `await capturePCM(seconds=2)` accepts `0 < seconds <= 5`, one capture at a time. Result includes frames, channels, sampleRate, RMS, peak, nonzero-output `audible` flag, SHA-256 and representation. Zero energy remains visibly **SILENT**, not a successful audible proof. The capture is the real post-master-gain output, not counters, offline synthesis or recorder re-encoding.
  The returned `pcm` is the bounded original interleaved Float32 `ArrayBuffer`, owned by the caller for lossless WAV export. `lastCapture`/`snapshot()` retain metadata only, never the PCM payload.
- `snapshot()` exposes actual context state, active BGM, voices, pending decode count, PCM bytes/cache entries, last native decode, last live capture, active effect/frame and unsupported behavior.

Sound starts unmuted at the documented browser backend preference. Capture-phase, trusted `pointerdown` and `keydown` observers create/resume the AudioContext synchronously on the first browser-supported user activation. They never prevent the action, stop propagation, or move focus; the original click/key continues to gameplay or UI. Concurrent gestures share one graph/BGM startup. Successful startup removes both observers; teardown removes them even if startup is pending. The **Enable / resume audio** control remains available for explicit activation or later suspension. Synthetic events do not unlock autoplay. Worklet support is required and failure remains visible; there is no fake permission prompt or silent success fallback. The worklet is a separate existing dev/build entrypoint beside `atlas-worker.js`.

Accepted UI events dispatch BtMouseOver/BtMouseClick. Main invokes Game/Jump only on accepted ordinary grounded jump; other jump-family choices remain unproved. Game/Portal follows successful atomic travel. Combat hooks play original equipped `swordL/Attack` at accepted attack start, Mob Damage/Die at accepted positive outgoing outcomes, authored Attack1–8 at attack start and CharDam1/2 for supported incoming attack outcomes. Body contact receives no invented hit sample. Tombstone follows a once-only player lethal transition. Original weapon queue offsets/tomb spawn synchronization remain unproved; no server skill sound is fabricated.

Incoming outcomes carry explicit `attackAction` provenance from the accepted authored impact; contact clears it even if that mob is still in an attack pose or retains `pendingAttack`. CharDam selection never infers the cause from mutable presentation state. A retained contact → authored impact → contact regression reproduced the wrong contact cue before the correction. [Current native PCM and gameplay evidence](client-audit.md#native-scenarios-and-evidence) is separate from the earlier captures below.

`009894f3` gives a distance **volume scalar, not pan**: `sqrt(dx²+dy²+0.001)`, below250→100, above1000→40, otherwise `trunc(120−0.08×distance)`. `0043fdab` truncates `master×percent/100` before the recovered backend gain curve. Active voices recompute that composition when settings change. [Combat evidence](ghidra-client-corrections/combat-summary.json) retains addresses and separates recovered values from local event scheduling.

## Browser ownership policies and unsupported transitions

Engineering bounds, not original constants:160MiB decoded PCM,64 cache entries, one decoder job,32 pending demands,24 voices, five-second stereo capture,32 indexed effects, one resident preview and512 selected maps. Original current-track buffers stay pinned by voices; only unpinned entries evict. Network and artwork reuse the existing shared owners. Field combat digits use64×10 preallocated sprites and retire before their visual lease.

Decode validates original channel count, finite PCM, nonzero energy, sample/frame bounds and duration against field30 with a documented browser tolerance of max(300 ms,1%) for MP3 delay/padding. Native decoding may resample; original sampleRate and decoded sampleRate are distinct. No per-frame audio allocation occurs. Source `ended` handlers release pins and disconnect nodes. Teardown aborts demand, invalidates generations, stops/disconnects sources, destroys effects before leases, empties PCM cache, removes DOM/listeners and closes the context. Failed BGM decoding retains the prior track; stale replacements cannot start audio or mutate effect state.

BGM selection owns a separate cancellation signal. A newer map aborts obsolete queued/native-decode validation before it can pin a stale cache entry. Native decoding itself is not interruptible; cancelled results are rejected on return. The original playing voice remains pinned until successful replacement. The isolated native pass exposed a stale KerningSquare pin causing `Pinned PCM cache budget exhausted`; [fixed-bgm-cancellation.json](ingame-validation/fixed-bgm-cancellation.json) confirms the same pending-map sequence now reaches inNautilus, pending0, one voice,114,203,160 cache bytes and nonzero live output, without an error.

Every-sample PCM validation is sliced into at most 65,536 samples per synchronous block, with abort checks and an event-loop yield between blocks. Native `scheduler.yield()` is used when available; a task timer is the scheduling-only compatibility path. This applies to both decoded audio validation and live capture statistics; no samples are omitted.

Malformed or overlapping raw worklet capture requests report an error and cancel that failed capture, preventing a stale completion from settling a later host request. Valid subsequent capture and live pass-through remain functional. This protocol recovery does not claim physical-speaker output.

**Unresolved original BGM transition:** the caller's 600 argument is proved, but exact gain ramp/crossfade interpolation and DLL transition ownership are not. The browser currently switches immediately after successful replacement decode. This is explicitly a browser policy, not original fade fidelity. Original settings-slider mapping, device loss/recovery, sound priority/pan and original polyphony limits are also not reconstructed. No loops/emitters or synchronization offsets were fabricated for server-controlled effects.

## Executed evidence

[Native audio proof JSON](ghidra-ingame-audiovisual/native-audio-proof.json) records an actual installed Chromium investigation using **the production AudioEngine**, the shared Network class and every selected original raw MP3 payload. A throwaway local server served original bytes and unbundled modules; it was stopped and removed afterward. No project build, formatter, lint or tests were run by this domain during the concurrent writing wave.

- All 65 original BGM/UI/Game nodes (61 distinct encoded hashes) passed native PCM validation. Seven distinct BGMs cover all eight maps. Chromium output rate was 48 kHz; original BGM decoded durations differed from field30 by less than 1 ms. These numbers prove native decode compatibility for installed Chromium, not all browsers.
- Same-path BGM preserved the exact active voice.
- Live capture: 24,000 stereo frames at 48 kHz, BGM RMS `0.008339051297600692`, peak `0.21361157298088074`, SHA-256 `634891c0fc88932822b3e4324f25fbb840e6c80b787dd5561c3bcd0480ed225d`.
- BGM mute produced RMS/peak 0 and `audible:false` on the real graph.
- With BGM still muted, UI/BtMouseClick produced RMS `0.01159842426385601`, peak `0.12543492019176483`, SHA-256 `cfcd6df81c857fdd7fb5349243f9be3d63fec392d415a5e301efc2394cf78c11`, proving independent SE gain/output.
- Destroy observation: context `closed`, zero PCM bytes/cache entries and voices.
- Follow-up production-engine smoke after adding raw PCM ownership and sliced scans: KerningSquare validated 8,758,334 stereo frames while 124 task-timer turns ran during loading. A 12,000-frame stereo capture returned exactly 96,000 raw PCM bytes; `lastCapture` had no `pcm` property. A separate nonzero live capture in the same follow-up produced RMS `0.03918985301017455`; a capture at the track's initial silent onset correctly reported `audible:false`.

Integrated native controls/effects/audio were exercised by a separate workflow worker: [audio/report.json](ingame-validation/audio/report.json), twelve lossless Float32 WAVs and per-capture metadata. `ffprobe` independently recognizes stereo48kHz `pcm_f32le`; Main verified a two-second BGM recording. Captures include FloralLife, Aquarium, exact-zero muted idle, independent SE/BGM, gain changes, accepted native jump and portal cues. No subjective listening interface or original Windows loopback recording was available, so these are numerical real-graph evidence, not subjective fidelity claims. Tiny numerical residuals can set `audible:true`; that field means nonzero energy, not perceptual audibility. Dedicated integrated frame/stall/residency measurement is separate from concurrent playtesting.

## Windows capture requests

Request an original executable/version-hashed Windows capture with synchronized video and lossless audio for: both same-track Henesys map changes; distinct BGM changes including Aquarium; the entire 0..19 original BGM/SE settings sliders and mute states; 600-argument transition onset/ramp/old-track lifetime; Aquarium idle/moving/swimming bubble emission placement/cadence; LevelUp/JobChanged/QuestClear/Teleport sequence completion and origins; ordinary, swim, flight, ladder and drop-through jump sound choices; Portal versus Portal2; overlapping clicks/Game events and device loss. Include the server response/event timing for server-authoritative actions. Until available, do not describe these local previews or immediate browser BGM changes as original runtime parity.
