# Original character and attack geometry

This investigation uses the supplied `Maplestory_UNPACKED.exe` and original WZ archives, not a third-party client. Decompiled C is reconstructed machine-code evidence, not original source. The executable SHA-256 is `1198fa57ca5a7c489bae43ec13c69681d9cabe0f96762f3dc0357facf2e7d4df`; archive fingerprints are in [input-manifest.json](input-manifest.json). Research ran in the independent `/tmp/maple-physics-hitboxes` Ghidra project with Java 21 and Ghidra 12.0.4. No original Windows client execution or reference recording was available.

**Geometry is not damage eligibility.** The browser can inspect recovered bounds without claiming that an attack is currently damaging, that the selected reference weapon is equipped, or that an overlap would cause damage.

The integrated field now uses recovered ordinary signed±1500-ms player hit protection separately from geometry. Positive protection modulates opaque gray/normal RGB for two updates each on the original30-ms producer (**60ms per phase**); nonpositive protection does not blink. Ordinary player-attacked mobs instead use available authored `hit1` when damage reaches original `pushed`, without inheriting that player timer or blink. The special mob blink branch requires `damagedByMob`. These are distinct admission/presentation consumers, not a new rectangle or a sprite-alpha collision rule. [Interaction evidence](ghidra-client-corrections/interaction-skill-combat-provenance.json) records the exact branches; no slower player cadence was recovered.

The later [conditional-knockback recovery](ghidra-client-corrections/knockback-provenance.json) further separates damage, impulse and pose: player nonpositive outcomes/sentinel/active Stance resistance keep foothold and ladder contact; admitted ordinary impulse is **±270/−270**, not the older generalized200. Mob pushed admission, an independent hit deadline, attack-pose preservation and weapon-probability strong recoil are distinct branches. No damage rectangle is enlarged or disabled to implement resistance. [Offline combat](offline-combat.md#recovered-ordinary-player-hit-response) records the exact instructions, unresolved special controllers and distinguishing native profiles.

## Distinct meanings

- **Movement contact:** the actor's feet/contact point. The swept foothold computation at `0x009b34c8` is a point calculation, not a collision sweep of the visible sprite or the receiver rectangle. Motion evidence belongs to [physics-evidence.md](physics-evidence.md).
- **Player body:** the rectangle tested as a damage receiver. It is not the body canvas dimensions and is not used to collide against footholds.
- **Outgoing attack:** action/weapon-dependent afterimage range, skill-level area, or other attack-family calculation. There is no universal melee/ranged/skill box.
- **Incoming damage geometry:** a mob's contact receiver/body geometry, a separately selected mob attack area, or projectile/area-generation logic. A mob's body canvas rectangle is not automatically its attack range.
- **Artwork:** origin, width, height, anchors, and alpha describe drawing. A sprite can extend beyond the receiver, and an effect's own `lt/rb` can differ from its attack range.

## Recovered player receiver

[`player-body.txt`](ghidra-physics-hitboxes/player-body.txt), [`body-state.txt`](ghidra-physics-hitboxes/body-state.txt), and [`body-instructions.txt`](ghidra-physics-hitboxes/body-instructions.txt) retain the exact addresses.

`0x0045183b` takes a receiver rectangle output and an optional previous-position flag. Relative to its avatar object:

| Condition | Original local rectangle / operation |
| --- | --- |
| Ordinary avatar, `(state@+0x4e8 & ~1) != 10` | `(-22,-65)..(22,0)`, four DWORDs at `0x00af14b8` |
| Ordinary avatar, `(state@+0x4e8 & ~1) == 10` | `(-46,-31)..(0,0)`, four DWORDs at `0x00af14c8` |
| Custom/morph flag at `+0x4a0` nonzero | Replace with four cached integers at `+0x4a4..+0x4b0` |
| Ordinary avatar with mount-item category 190 or 193 | Offset ordinary rectangle by cached `(+0x4d4,+0x4d8)` and union with cached mount rectangle `+0x4c0..+0x4cc` |
| State bit zero | Mirror by negating both x ends and exchanging them |
| Current placement | Offset by cached position `(+0x10e4,+0x10e8)` |
| Previous-position flag nonzero | Union with base ordinary/morph rectangle, mirrored and offset by `(+0x10ec,+0x10f0)` |

The previous-position branch **does not repeat the mount offset/union**. The implementation preserves that asymmetry. `0x00451987` proves mount categories with integer division of item ID by 10,000 and comparisons with `0xbe`/`0xc1`.

State 10/11 is not merely guessed to be prone: `0x00451ec8` shifts off the facing bit, and its ordinary-avatar dispatch selects action index 33. The relevant branch is `0x00451fe4`; `0x004a411c` loads string ID `0x406` (`prone`), and `0x004a4139` initializes table address `0x00bec938 = 0x00bec620 + 33*24`. These instructions and the jump table are retained. `proneStab` is a separate animation index 32; an attack animation does not itself determine the physical receiver pose.

### Animation dependence beyond ordinary avatars

`0x004522a6` updates animation state and copies custom-frame rectangle fields from frame record `+0x10..+0x1c` to avatar `+0x4a4..+0x4b0`. For category 190/193 mounts it copies frame `+0x14..+0x20` into `+0x4c0..+0x4cc`, and derives offsets from two selected animation/anchor records. See [`avatar-state/004522a6.c.txt`](ghidra-physics-hitboxes/avatar-state/004522a6.c.txt).

Thus ordinary stand/walk/jump/ladder/rope animation frames do not resize the fixed receiver; morph and mount frames can. The browser supports **explicitly selected** morph rectangles and **explicit resolved** mount rectangle/offset inputs. It does not pretend that a single mount canvas part is the complete composed mount receiver. Automatic mount frame aggregation and anchor selection remain unsupported.

## Outgoing attacks

`0x0040ac78` reads original `lt` (string ID 5636) and `rb` (5647) for action metadata. `0x00414440` obtains an action's afterimage rectangle. Its caller `0x00950921` mirrors the rectangle when the facing bit is zero, offsets it by the actor position, then calls mob target selection `0x00678476`. Relevant mirror/translation paths are near `0x00951433` / `0x0095168e` and `0x00951215` / `0x00951230`. Raw [melee-path.txt](ghidra-physics-hitboxes/melee-path.txt) and instructions retain the branches.

The same caller has distinct skill-area and range-modification branches. `0x0075f464` reads skill-level `lt/rb`; `0x00950921` copies, mirrors, and places an explicit skill area near `0x009512ce`. The geometry preview supports that base transformation; it does **not** claim every skill uses that branch or that skill-specific extensions have been applied. Ranged/magic logic at `0x009537d5` / `0x0095571f` includes target-relative positions, skill-ID conditions, range calculations, projectiles, and multi-target paths.

Examples from original metadata:

| Source | Local bounds |
| --- | --- |
| `Character.wz:Afterimage/swordOS.img/0/swingO1` | `(-85,-51)..(-11,-11)` |
| Same variant, `swingO2` | `(-64,-50)..(5,2)` |
| Same variant, `swingO3` | `(-78,-41)..(-18,-14)` |
| `Character.wz:Afterimage/bow.img/0/proneStab` | `(-92,-11)..(-24,2)` |
| `Skill.wz:310.img/skill/3101005/level/1` | `(-130,-100)..(130,100)` |

`Character.wz:00002000.img` was traversed completely (4,965 nodes): **no `lt/rb` receiver or attack data exists there**. Moreover, many skill rectangles are non-damaging areas: `1101006` has `(-250,-150)..(250,150)` along with buff `pad/pdd/time`. Rectangle presence alone cannot classify a skill as an attack.

Attack input and animation frame timing are not fabricated into active hit phases. Afterimage variant/equipment selection, attack commands, target selection, and skill modifiers must be reconstructed together before automatic combat activation is justified.

## Incoming mob geometry and timing

`0x00664559` copies one of the mob's cached facing rectangles (`+0x40c` / `+0x41c`), offsets it by current position (`+0x510,+0x514`), and optionally unions the same geometry at previous position (`+0x518,+0x51c`). It is consumed by outgoing target selection and other mob interactions.

`0x0067fd81` separately loads mob attack metadata. `0x0066a517` obtains the player receiver using `0x0045183b`, mirrors/offsets attack range `+0x28`, and applies rectangle intersection, with numerous state/eligibility branches. The exact type-0 scheduled attack construction is clearer in [`0066d9c0.c.txt`](ghidra-physics-hitboxes/mob-body-refs/0066d9c0.c.txt): near `0x0066de86`, it creates a pending record, writes time `attackRecord[+0x8c] + currentTime`, copies the range rectangle, mirrors x when facing zero, and translates at `0x0066deeb`.

Types 1/2 and 3/4 follow different code. In particular type 3/4 uses area-count/attack-count/bit-mask and terrain/placement logic; a single `range.lt/rb` is not the complete resulting attack geometry. The runtime rejects a `mob-attack` descriptor unless `attackType === 0`.

`Mob.wz:9500332.img/attack1/info/range` is `(-946,-511)..(-60,65)`, with original `type=0`, `attackAfter=1000`, `effectAfter=120`. Its `effect0` uses a **different** rectangle `(-950,-510)..(-60,65)`. `attack3` has `type=0`, range `(-815,-245)..(-10,60)`, and `attackAfter=600`. `attack2` is type 3 and remains unsupported as a single-area attack. Original timing values are retained for inspection, not converted into guessed damaging durations or repeated hits.

A visible counterexample to sprite-bound inference is `Mob.wz:9500332.img/stand/0`: canvas 416×364 at origin `(217,336)` but explicit receiver `(-192,-272)..(198,0)`. `0100101.img/move/1` likewise has width 37, origin x=15, but explicit `lt.x=-13`, `rb.x=24`.

## Browser API and extraction

`createHitboxState()` allocates reusable `body`, `attack`, `damage`, `previous`, and `contact` slots. `updateHitboxes(output,sim,context)` mutates them without allocating per tick.

- `body` means player damage receiver; `attack` means outgoing area; `damage` means incoming mob area/contact geometry. `contact` is a point.
- `active` means **valid nonempty geometry available to draw**, not an active damage phase. `verified` refers to the geometry formula/provenance. `unknown` remains true for attack/damage activation, even when geometry is verified.
- `activationKnown=false`, `damaging=null` explicitly prevent the preview from claiming combat eligibility. Body geometry can be known while damage eligibility is not.
- `requested`, `status`, `unsupportedActive`, and `unsupported` preserve missing data and unsupported requested families. Missing/invalid metadata does not reuse a stale active shape.
- Positions are world pixels; facing is -1 left / +1 right. Fractional simulation positions are preserved for overlay placement. Original cached positions are integer fields; this overlay policy is not a claim about the original float-to-integer rounding stage.
- Ordinary prone depends on `sim.crouching && sim.state === 'ground'`, not sprite frame number. `context.action/frame/elapsedMs/attacking` do not invent frame hit windows.

Optional context descriptors:

```js
context.attack = { kind: 'afterimage', rectangle }; // or 'skill-area'
context.damage = { kind: 'mob-attack', attackType: 0, rectangle, x, y, facing };
context.damage = { kind: 'mob-contact', rectangle, x, y, facing };
context.body = { kind: 'morph', rectangle };
context.body = { kind: 'mount', rectangle, itemId, offsetX, offsetY };
context.previousPosition = { x, y }; // optional original swept receiver branch
```

A rectangle is `{left,top,right,bottom,source}` in the original left-facing local coordinates. Outgoing descriptors default placement to the simulated actor; incoming descriptors require explicit placement. Mount rectangle and offsets must represent the resolved selected frame/cache, not arbitrary artwork bounds. The caller changes a descriptor when its original frame/action/skill level changes.

`client/tools/hitbox-data.js` exports:

- `readRectangle(node,source)`: validated explicit original `lt/rb`, with scalar/vector properties retained; no sprite fallback.
- `readHitboxMetadata(root,source)`: bounded iterative selected-tree metadata extraction.
- `extractHitboxReferences(image)`: deterministic small versioned inspector set, using `image(archiveName,imgPath)` to reuse the packaging cache.

The latter returns `{schemaVersion:1,mode:'original-geometry-preview',activationKnown:false,damageOrigin,references:[{id,label,context,originalTiming?}],unsupported}`. It currently supplies 15 stable references (8 swordOS variant-0 actions, one skill area, two type-0 mob attacks, two mob contact frames, two morph frames). Descriptor JSON retains origin-zero incoming inputs facing left; the interactive preview deliberately relocates them to the browser actor's current feet and facing. This inspection transform is not evidence of active original combat. These are references, **not equipment attached to the ordinary rendered avatar**. Full extracted output is [inspector-references.json](ghidra-physics-hitboxes/inspector-references.json).

## Coverage and unsupported families

[WZ evidence](ghidra-physics-hitboxes/wz-rectangles.json) records complete traversal of these **19 selected IMG trees**, not all original attacks:

- Character body `00002000.img`; afterimages `swordOS`, `bow`, `barehands`; mount `TamingMob/01902001.img`.
- Skills `100`, `110`, `200`, `210`, `300`, `310`, `400`, `420`, and `MobSkill.img` (11,529 nodes in the latter).
- Mobs `0100100`, `0100101`, `9500332`, `8500002`.
- Morph `0001.img`.

Unexamined or not implemented end-to-end: other weapon/afterimage variants and equipment selection; most second/third/fourth-job and later-job skill families; ranged projectile trajectories and impact areas; charged attacks; skill-specific range modifications beyond supported Slash Blast; summons; traps/persistent areas; mob projectile types1/2 and terrain/generated types3/4; mob skill eligibility/effects; transformations beyond the selected morph; mount composition and automatic frame/anchor selection; special damage cancellation/status gates and networking authority. Ordinary player protection, `pushed`-gated mob reaction and the supported local target cap are no longer universally unavailable; see [combat](offline-combat.md) and [skills](skills.md) for their precise scope. Slash Blast requires an eligible target inside the original basic weapon rectangle before extending forward to authored absolute range130, with unchanged vertical bounds and authored `mobCount` cap. A bow afterimage melee rectangle is **not** a bow projectile hitbox. A MobSkill/buff rectangle is **not** automatically a damage area.

## Proof and requested original captures

The rendererless [geometry smoke](ghidra-physics-hitboxes/geometry-smoke.json) records 30 original-reference/orientation executions, prone swept union, explicit mount-input arithmetic, stable output-slot identity, and inactive rejection of unsupported type3 / missing attack metadata. The mount arithmetic probe uses a selected original part as an explicitly supplied rectangle: it does **not** verify complete mount composition. Reference extraction ran twice and produced identical 5,005-byte compact JSON. Final integrated source validation passed strict lint and 140 tests / 822 assertions; the browser evidence below remains separately scoped.

The historical [native-input report](ingame-validation/interaction-corrections/report.json) adds actual browser standing→prone receiver selection:44×65 from `00af14b8`, then46×31 from `00af14c8`. Its contact checks predate the conditional-knockback correction and used the then-current±200/−200 impulses; that capture is not evidence for the corrected270 ordinary producer or Stance. Its60-ms tint phases and nonfatal Red Snail `hit1` remain separately scoped. The newer rendererless conditional proof exercises actual extracted211040000 floors, thresholds and admitted/refused impulse branches, not keyboard/browser or original Windows visuals.

To close combat/timing fidelity gaps, capture the **supplied exact original build** on Windows, not a recording from a different version. Record world position, facing, physical state, displayed action/frame, frame start timestamps, weapon item ID, afterimage variant, skill ID/level, mob ID/action/type, and attack command time. Capture stand→prone→prone-stab→stand both directions, walk/jump/ladder receiver stability, selected morph frames, and mount frame/anchor transitions. For attacks record both the target-selection rectangle and the later hit/eligibility result; video alone cannot establish an invisible range. Useful address probes are `0x0045183b` (receiver), `0x00414440` / `0x00950921` (melee/skill range), `0x00664559` (mob receiver), `0x0066d9c0` (scheduled mob area), and the pending-hit record consumers. Include the rectangles before/after mirroring/translation, old/current actor positions, and before/after the original `attackAfter` boundary. No supplied capture presently establishes damage-phase duration or validates browser-vs-original combat outcomes.
