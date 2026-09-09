# Learned skills and original skill coverage

## Sources and coverage

The catalog is extracted from the original `Skill.wz`, `Sound.wz` and `String.wz` inputs associated with the unpacked PE SHA-256 `1198fa57ca5a7c489bae43ec13c69681d9cabe0f96762f3dc0357facf2e7d4df`. No third-party client source is used. The retained complete inventories are `docs/ingame-inventory/Skill.tar.gz` and `Sound.tar.gz`. Cosmic's `AssignSPProcessor`, `GameConstants`, `SkillFactory`, `StatEffect` and `Character` are **authorized emulator references**, not Nexon source.

`ui-item-data.js` visits **every numeric player/job IMG**, not a selected beginner book or a top-N list. Original inventory extraction measured **71 numeric books and 534 skills**. The five other images—`MobSkill`, `MCSkill`, `MCGuardian`, `BFSkill`, `ItemSkill`—remain separately named non-learnable domains, including their original metadata. Named safety bounds reject excess work rather than silently truncating records.

Each `catalog.ui.skills[id]` preserves the existing `descriptor`, `iconPath`, `iconMouseOverPath` and `iconDisabledPath` UI interfaces and adds:

- `bookId`/`jobId`, family and original source; missing original strings are explicit via `stringsPresent`.
- `maxLevel` from numeric rank children; `masterLevel` retains the original top-level scalar, **not** an automatic learned/mastery grant.
- `levels[rank]` with original flat `hp`, `mp`, `time`, `hpCon`, `mpCon`, `cooltime`, `damage`, `mobCount`, `x`, `y`, etc. `level` retains the original metadata tree, including aliases.
- Original `properties`, prerequisite edges, ordered actions (including original scalar-action forms), normalized flags and allocation-cost evidence.
- Every visual sequence, including nested rank, `CharLevel`, `finalAttack`, `prepare`, `affected`, `hit`, `ball`, `special`, and other authored branches. Original frame delay/origin/alpha and source identities flow through the existing atlas/part pipeline. Unresolvable aliases are explicit unavailable records.
- Every skill sound leaf, exact leaf name, alias and resolved source identity. Missing sound trees are explicit original absence. Sound payloads are original MP3s, not synthesized replacements.

`catalog.ui.coverage.skillCoverage` contains sorted `playerBooks`, separate `domains`, `total` and deterministic capability `counts`. Classifying all 534 retained original records produced:

| Classification | Runtime-capable | Unavailable dependency |
| --- | ---: | ---: |
| Passive | 10 | 70 |
| Self-stat buff | 4 | 0 |
| Sword melee | 2 | 0 |
| Other weapon/projectile | 0 | 191 |
| Channel | 0 | 17 |
| Morph/movement | 0 | 5 |
| Other attack | 0 | 61 |
| Special/party/target | 0 | 107 |
| Summon | 0 | 23 |
| Map/door | 0 | 1 |
| Magic | 0 | 19 |
| Item/projectile-consuming | 0 | 10 |
| GM/event/server | 0 | 14 |

These are capability classifications, **not a claim of complete native runtime fidelity**. The generated catalog computes them anew from the extraction input. Unavailable records state the missing controller/transaction/server prerequisite and remain visible in the full catalog.

## Learning and admission

`SkillSystem(scene, store, catalog, hooks)` owns learned-skill admission. Schema-3 profile records are `{level, masterLevel, expiresAt}`; `expiresAt` is `null` or an epoch-millisecond integer, and `remainingSp` has exactly ten pools. No job change or catalog membership grants ranks. Learning and persistent development edits use the same atomic profile transaction: gameplay mutations are excluded while `profileTransactionPending`, and consumers reacquire the replacement profile after success or failure. See [atomic ownership](offline-profile.md#atomic-ownership).

`await skills.learn(id)` runs through `await store.commitProfile(transform)`. It checks job ancestry, original flags, prerequisites, character-level restrictions, max/master caps and the correct SP pool. Ordinary allocation spends one point according to the authorized Cosmic reference. Beginner IDs ending in `1000..1002` instead share entitlement `min(characterLevel - 1, 6)`; they do not spend normal SP. Fourth-job mastery must already exist in the profile. Unknown authored allocation-cost forms are unavailable rather than guessed. `skillPointPool(book)` is the shared zero-based selector: books 2210–2218 use indices 1–9; other books use index 0. Learning eligibility is separate from runtime capability: a saved rank does not provide a missing attack, projectile, summon or other controller.

`skills.activate(id)` returns `{ok:true}` or `{ok:false,reason}`. It is synchronous and validates learned/unexpired rank, job, alive/modal/map state, cooldown, prepared resources, actor actions, field attack readiness, equipment and costs **before any gameplay mutation**. HP costs cannot kill the caster; exact MP equality is allowed. Unsupported casts do not spend HP/MP, start actions, start cooldowns or emit Use audio.

Type-1 key bindings use learned, unexpired ownership. They call `hooks.onSkill(id)` through the normal input authority; catalog membership is not ownership. KeyConfig's live nonmodal draft, explicit Save and Cancel semantics remain unchanged.

## Implemented consumers

- Warrior `1000000` exposes original rank `hp` to native recovery. `1000002` exposes original Endure `time`. Recovery cadence/conditions belong to the native recovery owner, not a second SkillSystem timer.
- Magician `2000000` supplies the recovered `trunc(characterLevel * learnedRank * 0.1)` MP bonus. Thief `4100002/4200001` supplies authored HP/MP/climbing recovery; knight `1110000/1210000/11110000` supplies authored MP recovery. These effects are classified supported rather than silently applying behind an unavailable label.
- Warrior `1000001` and Dawn Warrior `11000000` expose max-HP growth `x`/`y`. Cosmic `Character.java:6358–6360` consumes `x` at level-up; `y` belongs to HP AP allocation, whose controller is not implemented here. The field's provisional base progression must remain labeled separately.
- Iron Body `1001003` rank 1 costs MP 8 and adds PDD 2 for original `time=75` seconds. The same strict self-stat shape supports `11001001`, Magic Armor `2001003` and `12001002`; unsupported additional rank fields or party/affected/weapon/special branches prevent false self-only admission.
- Power Strike `1001004` rank 1 costs MP 4 and supplies original `damage=165` to the sole field attack owner.
- Slash Blast `1001005` rank 1 costs HP 8 / MP 6 and supplies `damage=72`, `range=130`, `mobCount=6`. At the authored hit phase, the field first places the original weapon attack rectangle. Only an eligible target inside that basic rectangle unlocks the absolute forward extension to avatar X ±130; it is not a percentage scale or unconditional extra reach, and vertical bounds remain unchanged. The resulting selection is capped at the authored target count. Original consumer `00951571..0095165c` is retained in the [range instructions](ghidra-client-corrections/fidelity-slash-range-insns.txt). This source-backed contract does not by itself establish native browser multi-target coverage.

Cached `derived()` exposes `pad,pdd,mad,mdd,acc,eva,speed,jump` modifiers. Recasting a buff refreshes its duration without stacking. Different simultaneous self-stat effects use a declared **local strongest-absolute-modifier policy**; original cross-skill overwrite precedence has not been recovered. The field combines these with its own stats/damage policy. WZ damage percentages and resource/effect timing are not a recovered original server damage formula.

Cooldowns use original rank `cooltime` seconds. Buffs and cooldowns belong to the character session and transfer across ordinary map commits, but are not silently persisted across reload. Death clears active buffs. Learned expiration is epoch-based and independent of cooldown duration; original cooldown persistence is not claimed.

## Resource ownership and integration contract

The field integration supplies:

```js
const skills = new SkillSystem(scene, store, catalog, {
  services, // shared hash-verified network + atlas leases
  audio, // shared AudioEngine, not a second output graph
  report, // accepts Error
  isBlocked,
  validateCast, // (skill, info) => null | reason, includes map/state/action readiness
  supportsAction, // action => boolean; never invent an absent actor pose
  validateAttack, // (skill, info) => null | reason, no mutation
  admitAttack, // (skill, info, onHit) => void; synchronous guaranteed admission
  startAction, // action => void; already admitted by validateCast
});
```

`admitAttack` is the existing field's sole combat authority, not a second attack path. Its immediately preceding `validateAttack` must guarantee admission without a later refusal or asynchronous boundary. It calls `onHit(skillId, target)` once per admitted target at the authored hit phase. `startAction` similarly cannot reject after validation. Passive recovery uses `skills.level(id)` and `skills.info(id, rank)`; damage/defense consumers read the cached `skills.derived()`.

Call `await skills.prepare()` outside ticks after field entry and learned-profile changes. Call it again after enabling audio: audio cannot decode before the browser gesture creates the shared context. Preparation is serialized, bounded to 64 resident learned skills and 128 sequences per skill, and canceled on teardown. New requests during preparation are coalesced into the same promise and drained within an explicit 64-round admission bound. Casts refuse unprepared original resources rather than silently casting invisibly. Visual slot exhaustion also refuses before costs.

The owner preallocates display/animation slots, pins decoded Use/Hit entries, retains its started voices and aborts/releases all owned work on `destroy()`. `step(ms)` updates existing cooldown/buff/display state without snapshots, new arrays, text geometry or asynchronous loading. Run it once in the field's simulation order before combat/recovery; destroy it before releasing scene overlays and shared audio/atlas services.

Original `1001003` has `action/0=alert2` and a Use sound but **no skill effect canvases** in `100.img`; no substitute effect is fabricated. Power Strike and Slash Blast use their original baseline `effect` and `hit/0` sequences. Alternate hit and `CharLevel` assets are fully catalogued, but native selection of those alternatives is not recovered; the baseline presentation choice is explicit local policy. These three skills have no original Hit sound leaves; the skill owner does not replay Use as a fabricated Hit. Existing field mob-hit audio remains its own native event consumer.

## Verification boundary

The current integrated source passed strict lint and 128 tests / 751 assertions. The all-record classification above comes from original-inventory extraction, not from exercising 534 skills. Retained skill regressions cover mutation-free unprepared/HP/map refusals, buff expiry/recast, learned-expiration/cooldown boundaries, prerequisites/master caps and beginner entitlement.

Through actual native Skill-window buttons, HP Recovery and Power Strike were learned with SP 10→9→8; both ranks persisted after reload. Native two-click Power Strike activation then changed MP 100→96 and entered the attack phase without an error. These observations establish learning, durable ownership and cast admission for those exercised paths, not target damage, every passive, buff overlap, Slash Blast range or unavailable controllers. See the [current fidelity report](ingame-validation/fidelity/report.json) for the integrated observations and remaining boundaries. No Windows-runtime comparison is available, and native fidelity across all supported classifications remains unproved.
