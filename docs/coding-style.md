# JavaScript coding style

**Required for every coding agent and every hand-written JavaScript change.** This is the authoritative policy; `AGENTS.md` only links here. Apply it to client code, Bun tools, tests, and future server code. Generated bundles and retained Ghidra decompilation are evidence/output, not hand-written implementation.

Adapted from Gerard J. Holzmann's [The Power of Ten (2006)](https://spinroot.com/gerard/pdf/P10.pdf), with the [requested overview](https://en.wikipedia.org/wiki/The_Power_of_10:_Rules_for_Developing_Safety-Critical_Code). These adaptations improve reviewability; they do not certify JavaScript or this game as safety-critical software.

## Ten adapted rules

1. **Simple control flow; no recursion.** No direct or indirect synchronous recursion, `eval`, dynamic `Function`, labeled jumps, or control flow hidden in generated strings. Prefer explicit state machines, early validation returns, and ordinary bounded iteration. Traverse WZ trees and foothold graphs with bounded queues/stacks and visited IDs, not recursive calls.
2. **Every unit of work is bounded.** Bound collections before iterating. Every traversal, parser, retry, collision iteration, and catch-up loop has a named maximum or a previously validated finite collection bound. Detect cycles. On exhaustion return an explicit error/status; never silently truncate physics options, assets, or simulation time.
3. **Keep allocation out of hot loops.** JavaScript cannot forbid its runtime's allocation or garbage collection. Instead, preallocate physics state, input state, contact scratch storage, sprite pools, and metric rings before play. Do not create arrays/objects/closures, spread/map/filter/sort collections, build strings, or log per physics tick/draw. Allocate asset batches outside the tick within explicit byte/concurrency limits. Account separately for decoded CPU bytes, atlas/GPU estimates, and persistent-cache bytes; release ImageBitmaps, textures, listeners, and workers by ownership.
4. **Small functions.** At most 60 nonblank, noncomment lines per function; one clear responsibility. Prefer at most four parameters, nesting depth four, and cyclomatic complexity twelve. Extract meaningful operations, not arbitrary wrappers solely to satisfy a counter. Keep units and original numeric conversions visible.
5. **Meaningful assertions.** Check real invariants: finite coordinates/velocities, valid foothold IDs, ordered ranges, bounded counters, correct buffer lengths, and asset-version compatibility. Assertions are side-effect-free conditions with explicit failure handling. Do not copy the C paper's numerical assertion quota or add tautologies. Keep input/corruption checks enabled in production. Test plausible failures and boundaries, not wiring or wording.
6. **Narrow scope and explicit ownership.** Prefer `const`, use `let` only for mutation, never `var`. No ambient mutable globals except the documented browser inspection API. Keep state in its owning subsystem. Avoid shared mutable aliases; transfer worker buffers deliberately and treat validated manifests as read-only.
7. **Validate inputs and handle outcomes.** Validate file/network/worker/user boundaries, finite numbers, integer IDs, limits, enum values, and version hashes. Functions document preconditions and units with JSDoc. Check HTTP status and decode results; await promises or attach explicit error handling. No empty catches, ignored rejections, guessed defaults, or success-shaped fallbacks. Cancellation is an explicit outcome; retain the last complete visible state on failed replacement. Internal helpers may rely on a documented, already-validated state contract rather than rechecking every scalar on every tick.
8. **No preprocessor-style obfuscation.** Plain ES modules and explicit configuration, no runtime code generation or hidden feature-matrix branches. Use named constants for engineering limits. Original-game constants must link to WZ/source/Ghidra evidence; distinguish configurable browser policies from recovered behavior. No TypeScript, transpiled type syntax, or third-party-client code as an implementation source.
9. **Constrain references and callbacks.** JavaScript has no raw pointers; avoid deep mutation chains, implicit coercion, prototype mutation, and unrestricted dynamic property dispatch. Browser events, workers, and `requestAnimationFrame` require callbacks: named handlers, explicit registration/removal and ownership, no synchronous callback cycles. Async scheduling the next frame is not recursive stack growth. Use validated enum dispatch rather than arbitrary string-to-function execution.
10. **Strict static checks and reproducible proof.** Use Bun for installation, scripts, linting, formatting, and tests. ESLint must finish with zero warnings (`--max-warnings 0`); Prettier controls layout. No inline lint suppression to hide a defect. Mechanically check what tools can establish; review indirect recursion, allocation, bounds, and evidence provenance explicitly. A clean lint result is not proof of original physics fidelity.

## Browser and simulation adaptations

- A continuous game loop intentionally has no lifetime bound. Each callback has bounded work and schedules at most one successor; cancellation/shutdown stops scheduling.
- Simulation time is independent of rendering cadence. Use a documented fixed integration quantum or recovered update cadence. Bound catch-up work; expose overload rather than silently dropping elapsed time or changing movement speed. Pausing on hidden tabs is an explicit lifecycle decision, not a physics constant.
- Keyboard handlers update preallocated input state. Consume input in the documented simulation order. Keep key-edge events distinct from held keys; clear held inputs on blur to avoid stuck movement.
- Async loading never runs an unbounded decode/upload batch in a render callback. Heavy conversion belongs in Bun extraction or a dedicated worker. Bound fetch concurrency, prefetch distance, decoded residency, persistent cache size, and staged GPU upload work. Unsupported device/asset limits fail explicitly.
- Deterministic tests may allocate snapshots outside the simulation step. Browser acceptance uses real keyboard/mouse input; inspection APIs observe state rather than replacing input-driven acceptance.

## Review checklist

- [ ] No direct/indirect synchronous recursion or unbounded work.
- [ ] Original constants/options have evidence; unknown behavior is named, not silently ignored.
- [ ] Physics/render hot paths avoid avoidable allocation and preserve numeric/update-order semantics.
- [ ] Errors, cancellation, resource ownership and teardown are explicit.
- [ ] Functions/variables are small and narrowly scoped; JSDoc describes data and units.
- [ ] Strict lint, meaningful regression checks, and actual changed-surface validation pass.
- [ ] `docs/` records coverage, measurements and remaining blockers without overstating fidelity.
