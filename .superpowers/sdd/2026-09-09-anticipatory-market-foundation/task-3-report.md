# Task 3 Report: Connect derivatives and provenance

## Status

Implemented `AnticipatorySnapshotService.build({ userId, provider, symbol, timeframe, sourceDataCutoff })` in observe-only mode. The service concurrently loads closed candles, the latest cutoff-safe indicator snapshot, funding history, open-interest history, and compatible optional context. It builds a runtime-parsed `AnticipatoryMarketSnapshot` and persists it through the existing agent-context repository.

No Decision, Risk, order submission, exchange permission, or LIVE behavior was changed.

## Implementation

- Added `AnticipatorySnapshotService` and registered/exported it from `AgentsModule`.
- Changed the derivatives predictor to consume actual funding and open-interest histories and return a discriminated `UNAVAILABLE` result when either minimum sample count is absent.
- Added cutoff support to indicator snapshot lookup and changed closed-candle lookup to bound `closeTime <= sourceDataCutoff` while requiring `isClosed: true`.
- Extended `AgentContextSnapshotRepository`, the closest existing repository abstraction, with:
  - cutoff-bounded compatible context lookup;
  - append-only/idempotent snapshot persistence keyed by user, provider, symbol, timeframe, and cutoff.
- Added service and repository coverage for concurrency, frozen-cutoff propagation, stale optional context, actual derivatives histories, insufficient-history behavior, runtime schema parsing, and persistence.

The repository file was not named in the original task file list, but the implementation ledger explicitly required extending the closest existing repository rather than placing direct Prisma access in the pure builder. No Task 4 opportunity model or migration was introduced.

## RED

Initial focused command:

```text
pnpm --filter @platform/api exec vitest run \
  test/agents/anticipatory-snapshot.service.spec.ts \
  test/derivatives-imbalance-predictor.spec.ts \
  test/market-data-repository.spec.ts
```

Observed expected failures:

- Service suite could not resolve the not-yet-created service.
- All six predictor tests failed because results had no `coverage` discriminator and insufficient histories produced a neutral-looking result.
- Indicator repository test failed because the query did not include `candleCloseTime <= cutoff`.

A separate closed-candle RED test failed because the repository bounded `openTime < cutoff` instead of `closeTime <= cutoff`. A context repository RED test also proved that compatible context rows were not filtered before selecting the latest row.

## GREEN

Focused verification after implementation:

```text
pnpm --filter @platform/api exec vitest run \
  test/agents/agent-context-snapshot.repository.spec.ts \
  test/market-data-repository.spec.ts \
  test/agents/anticipatory-snapshot.service.spec.ts \
  test/derivatives-imbalance-predictor.spec.ts \
  test/agents/anticipatory-snapshot-builder.spec.ts
```

Result: 5 test files passed, 33 tests passed, 0 failed.

```text
pnpm --filter @platform/api typecheck
```

Result: Prisma generation and `tsc --noEmit` exited 0.

```text
pnpm --filter @platform/api lint
```

Result: ESLint exited 0 with no findings.

## Self-review

- Every temporal source call receives the same frozen cutoff.
- Closed-candle queries use `isClosed: true` and cap candle close time.
- Funding and OI are sorted chronologically and passed as complete histories to the predictor.
- Missing derivatives samples remain `UNAVAILABLE`; the predictor does not create balanced/neutral evidence for that case.
- Stale optional context remains present with `STALE` provenance rather than being discarded or treated as fresh.
- The pure builder remains free of Prisma and persistence concerns.
- The persisted value is the exact snapshot that passed the shared runtime schema.
- Existing callers of latest indicator snapshots retain their behavior because the cutoff argument is optional.

## Dependency ordering concern

Task 4 should move persistence to its dedicated append-only `anticipatory_market_snapshots` model and enforce the provider/symbol/timeframe/cutoff idempotency key with a database unique constraint. The current adapter uses deterministic key lookup followed by create in the existing generic context table; it is suitable for Task 3 observe-mode wiring and test doubles, but the table cannot make that two-step operation race-safe without the Task 4 schema.
