# Meso Explosion animation placement

Skill `4211006` now creates one explosion at each consumed meso pile. Previously, `SkillSystem.hit` placed the default `hit/0` effect at each damaged monster, so the visual appeared at the wrong position and a cast with no monsters showed no explosions.

## Original executable and WZ evidence

Ghidra 12.0.4 exports from `Maplestory_UNPACKED.exe` (SHA-256 `1198fa57ca5a7c489bae43ec13c69681d9cabe0f96762f3dc0357facf2e7d4df`) establish the drop-owned effect. The original directory supplied an executable and archives; no original C/C++ source or Windows runtime capture was available.

- In the drop update handler `00504bff`, the expired removal-state branch reads saved coordinates from drop members `+0x74` (X) and `+0x68` (Y), removes the drop, and starts the skill effect independently of monster damage. See [explosion instructions](ghidra-client-corrections/meso-animation-instructions.txt) and the complete handler in [retained decompilation](ghidra-client-corrections/native-skills-meso-explosion.txt).
- The saved Y is already centered. Drop creation at `00505f39..00505f5a` subtracts `trunc(initialCanvasHeight / 2)` from landing Y before storing `+0x68`. See [creation instructions](ghidra-client-corrections/meso-animation-drop-creation.txt). The explosion therefore uses `X = groundX`, `Y = groundY - trunc(canvasHeight / 2)`, with no current hover sine offset. The four original meso variants have initial heights `24, 24, 30, 31`, giving offsets `12, 12, 15, 15` pixels.
- `0050570f` chooses a random entry from the hit list; `00505765` resolves the rank/general hit collection. See [selection decompilation](ghidra-client-corrections/meso-animation-hit-selection.txt) and [lookup decompilation](ghidra-client-corrections/meso-animation-hit-lookup.txt). `Skill.wz:421.img/skill/4211006/hit` has nine alternatives, `0..8`, each lasting 510ms. Their packaged descriptors and the original currency canvas dimensions are retained in [WZ evidence](ghidra-client-corrections/meso-animation-wz.json).
- The effect call passes a null parent vector and flip zero. `0040b31f` only unwraps the selected string; it does not consume the preceding zero argument. See [call instructions](ghidra-client-corrections/meso-animation-call-instructions.txt). The explosion remains fixed and unmirrored when the player moves or turns. Authored frame origins remain in the existing WZ rendering pipeline.
- `00504d0d` limits the Hit sound to one start per 90ms. The current server consumes a batch simultaneously, so that batch plays one Hit voice.

The available Cosmic server's `AbstractDealDamageHandler.removeExplodedMesos` independently removes the selected drops and supplies delayed-removal packets. This patch retains this project's existing simultaneous committed-drop timing; it does not claim to reproduce Cosmic's staggered packet schedule or establish original Windows frame timing.

## Shared implementation

`SkillMesoPresentation` prepares all nine original hit sequences and reads currency height metadata before gameplay. Each sequence reserves up to the native 20-pile limit, including the case where every pile randomly selects the same variant. Admission checks capacity before consuming any drops. Playback uses copied landing coordinates and does not follow a reused drop object, the player, or a monster.

`SkillTargetController` plays these effects after committed consumption and passes no ordinary monster-hit callback for Meso Explosion. Other target skills retain their existing hit effects. The authoritative server publishes the same fixed positions and authored bundles through `skill.visual`, using the shared implementation. The caster's `effect` animation remains separate. Damage uses the user-selected [modern combat formulas](combat-formulas.md).

## Scoped verification

- `server/test/meso-animation.test.js` exercises actual packaged WZ sequences, a 20-pile cast without monsters, all nine visual variants, fixed positions after player movement, full pool recovery, and capacity refusal.
- The existing first-cast formula and target-rectangle tests continue to pass.
- `bun server/tools/check-meso-explosion.js --output DIR` uses a disposable Chief Bandit account, native meso-drop controls and the bound skill key. It checks three separated piles in each facing direction, observes rendered origins, captures the explosions, and reconnects to verify the spent mesos.

Browser results are indexed in [validation](validation.md). Executable/WZ recovery and browser acceptance do not substitute for an original Windows runtime comparison.
