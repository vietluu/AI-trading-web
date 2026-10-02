# Probe Economics and Live-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the proactive cold-start deadlock so valid immature cohorts can collect bounded DEMO/SHADOW evidence without bypassing geometry, data-quality, risk, quant, or exchange-safety controls.

**Architecture:** Add explicit economics provenance to `DecisionOutput`, preserve that provenance through calibration, and make Decision Risk and Judge apply empirical EV/PF thresholds only when exact lifecycle probability is authoritative. Tighten critic loss context to the exact thesis cohort and cover the complete pipeline with real deterministic gate instances rather than approving doubles.

**Tech Stack:** TypeScript 5.8/5.9, NestJS 11, Zod 3, Prisma 6, Vitest 3, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-01-probe-economics-live-readiness-design.md`

## Global Constraints

- Do not lower risk-per-trade, leverage, exposure, drawdown, spread, stale-data, collateral, or exchange-protection limits.
- `SUPPRESSED` always blocks execution.
- `PROBE_ONLY` must never produce a composed size factor greater than `0.15`.
- Only `EXACT_LIFECYCLE` probability may govern proactive empirical EV and profit factor.
- Missing probability is not a 50% estimate and must not borrow broader calibration.
- Existing non-proactive decision behavior remains backward compatible.
- No LIVE order is submitted by this implementation.

---

### Task 1: Explicit Economics Authority Contract

**Files:**
- Modify: `packages/shared/src/schemas/agents.ts`
- Modify: `packages/shared/test/agents.spec.ts` or the existing DecisionOutput schema test file found with `rg -n "DecisionOutputSchema" packages/shared/test`

**Interfaces:**
- Produces optional `economicsAuthority` on `DecisionOutput`:

```ts
economicsAuthority: z.object({
  probabilityAuthority: z.enum(['EXACT_LIFECYCLE', 'UNAVAILABLE']),
  lifecycleAction: z.enum(['FULL_SIZE', 'PROBE_ONLY', 'SUPPRESSED']),
  sampleSize: z.number().int().nonnegative(),
  empiricalWinProbability: z.number().min(0).max(1).nullable(),
}).strict().optional()
```

- Absence means legacy/non-proactive behavior and retains existing gate semantics.

- [ ] **Step 1: Write failing schema tests**

Add one test accepting a valid exact authority object and one rejecting
`UNAVAILABLE` with a non-null empirical probability:

```ts
expect(DecisionOutputSchema.parse({
  ...validDecision,
  economicsAuthority: {
    probabilityAuthority: 'EXACT_LIFECYCLE',
    lifecycleAction: 'FULL_SIZE',
    sampleSize: 30,
    empiricalWinProbability: 0.6,
  },
}).economicsAuthority?.sampleSize).toBe(30);

expect(() => DecisionOutputSchema.parse({
  ...validDecision,
  economicsAuthority: {
    probabilityAuthority: 'UNAVAILABLE',
    lifecycleAction: 'PROBE_ONLY',
    sampleSize: 12,
    empiricalWinProbability: 0.5,
  },
})).toThrow();
```

- [ ] **Step 2: Run the schema test and verify RED**

Run the exact shared-package test selected in Step 1. Expected: the strict
schema rejects the new property or fails the cross-field assertion.

- [ ] **Step 3: Implement the schema contract**

Add the optional strict object and a `superRefine` invariant:

```ts
if (
  value.economicsAuthority?.probabilityAuthority === 'UNAVAILABLE' &&
  value.economicsAuthority.empiricalWinProbability !== null
) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['economicsAuthority', 'empiricalWinProbability'],
    message: 'Unavailable probability authority requires a null probability',
  });
}
```

- [ ] **Step 4: Run shared tests and verify GREEN**

Run: `pnpm --filter @platform/shared test`

- [ ] **Step 5: Commit the contract**

```bash
git add packages/shared/src/schemas/agents.ts packages/shared/test
git commit -m "fix: model proactive economics authority explicitly"
```

---

### Task 2: Authority-Aware Decision Risk and Judge Gates

**Files:**
- Modify: `apps/api/src/modules/risk/application/decision-risk-policy.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/decision-judge.service.ts`
- Modify: `apps/api/test/risk/decision-risk-policy.service.spec.ts` if present; otherwise create it beside other risk policy tests
- Modify: `apps/api/test/pipeline/decision-judge.spec.ts`

**Interfaces:**
- Consumes `DecisionOutput.economicsAuthority`.
- Skips only empirical EV/PF comparisons when authority is `UNAVAILABLE` and action is `PROBE_ONLY`.
- Continues to reject `SUPPRESSED`, unsafe geometry, stale data, excessive spread, insufficient evidence, excessive risk, and every existing non-economic reason.

- [ ] **Step 1: Write failing Decision Risk tests**

Use a complete actionable decision fixture with `expectedValue: 0`, valid
`executionEvidence.expectedNetR`, and unavailable probe authority. Assert it is
not rejected as `EXPECTED_VALUE_NEGATIVE`. Add controls proving the same
decision without authority still rejects and a `SUPPRESSED` decision rejects.

- [ ] **Step 2: Run the Decision Risk tests and verify RED**

Run the exact spec with Vitest. Expected: the unavailable probe returns
`EXPECTED_VALUE_NEGATIVE` before implementation.

- [ ] **Step 3: Implement the minimal Decision Risk authority branch**

Derive:

```ts
const unavailableProbe =
  output.economicsAuthority?.probabilityAuthority === 'UNAVAILABLE' &&
  output.economicsAuthority.lifecycleAction === 'PROBE_ONLY';
```

Reject `SUPPRESSED` explicitly. Preserve every existing check, but do not use
placeholder `expectedValue` as empirical evidence for `unavailableProbe`.
Continue to require positive geometric `executionEvidence.expectedNetR` when it
is present.

- [ ] **Step 4: Run Decision Risk tests and verify GREEN**

- [ ] **Step 5: Write failing Judge tests**

Assert a fresh, high-quality unavailable probe with valid geometry does not
receive `EXPECTED_VALUE_TOO_LOW`, `PROFIT_FACTOR_TOO_LOW`, or
`UNSAFE_GEOMETRY`. Add controls for stale core data, excessive spread,
suppressed authority, and legacy decisions.

- [ ] **Step 6: Run Judge tests and verify RED**

Run: `pnpm --filter @platform/api exec vitest run test/pipeline/decision-judge.spec.ts`

- [ ] **Step 7: Implement authority-aware Judge geometry**

Keep `unsafeGeometry` true for malformed or non-positive geometric reward. For
an unavailable bounded probe, exclude only empirical EV and PF placeholders
from `unsafeGeometry` and from the later reason list. Add a stable
`EXACT_LIFECYCLE_SUPPRESSED` block reason for suppressed authority.

- [ ] **Step 8: Run both gate suites and verify GREEN**

- [ ] **Step 9: Commit gate semantics**

```bash
git add apps/api/src/modules/risk/application/decision-risk-policy.service.ts apps/api/src/modules/pipeline/application/decision-judge.service.ts apps/api/test
git commit -m "fix: allow bounded probes through empirical economics gates"
```

---

### Task 3: Preserve Thesis Authority Through Calibration

**Files:**
- Modify: `apps/api/src/modules/agents/application/services/decision.service.ts`
- Modify: `apps/api/test/agents/calibration-authority.spec.ts`

**Interfaces:**
- Consumes a synthesized decision carrying `economicsAuthority`.
- For proactive exact lifecycle authority, preserves the supplied empirical
  probability, EV, PF, and authority instead of replacing them with broader
  confidence-calibration probability.
- For unavailable proactive authority, preserves null provenance and neutral
  compatibility telemetry without introducing `0.5` as authority.
- Decisions without the property retain current calibration behavior.

- [ ] **Step 1: Write failing calibration tests**

Add three cases:

```ts
it('does not replace exact lifecycle economics with broader calibration', ...)
it('does not invent probability for an unavailable proactive cohort', ...)
it('keeps legacy calibration behavior when economics authority is absent', ...)
```

For the first case, supply exact lifecycle `0.60` while the calibration mock
returns `0.80`; assert the result remains `0.60` with the original EV and PF.

- [ ] **Step 2: Run calibration tests and verify RED**

Run: `pnpm --filter @platform/api exec vitest run test/agents/calibration-authority.spec.ts`

- [ ] **Step 3: Implement preservation at the calibration boundary**

Branch before broader probability recomputation. Keep confidence calibration
metadata for observability, but let proactive `economicsAuthority` exclusively
own proactive probability economics. Ensure the returned object remains valid
under `DecisionOutputSchema`.

- [ ] **Step 4: Run calibration and decision suites and verify GREEN**

Run:

```bash
pnpm --filter @platform/api exec vitest run test/agents/calibration-authority.spec.ts test/agents/decision-data-quality.spec.ts test/pipeline/decision-judge.spec.ts
```

- [ ] **Step 5: Commit calibration preservation**

```bash
git add apps/api/src/modules/agents/application/services/decision.service.ts apps/api/test/agents/calibration-authority.spec.ts
git commit -m "fix: preserve exact thesis economics through calibration"
```

---

### Task 4: Exact-Cohort Critic Loss Context

**Files:**
- Modify: `apps/api/src/modules/reflection/application/self-learning.service.ts`
- Modify: `apps/api/test/reflection/self-learning.service.spec.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`

**Interfaces:**
- Change `recentLossesForThesis` input from the symbol/timeframe pick to:

```ts
Pick<ThesisCohortKeyParams,
  'symbol' | 'provider' | 'timeframe' | 'regime' |
  'direction' | 'setup' | 'configurationHash'>
```

- [ ] **Step 1: Write failing exact-loss query tests**

Assert Prisma receives every supplied cohort field plus:

```ts
status: 'FINALIZED',
netR: { lt: 0 },
closedAt: { lte: asOf },
```

Also retain `orderBy: { closedAt: 'desc' }` and clamped `take` in `1..5`.

- [ ] **Step 2: Run the self-learning test and verify RED**

Run: `pnpm --filter @platform/api exec vitest run test/reflection/self-learning.service.spec.ts`

- [ ] **Step 3: Implement exact filtering**

Add optional Prisma predicates for provider, regime, direction, setup, and
configuration hash. Do not weaken the pinned `closedAt` cutoff.

- [ ] **Step 4: Update the pipeline call**

Pass the selected, critic-reviewed thesis identity and the same provider and
configuration hash used by probability authority.

- [ ] **Step 5: Run reflection and proactive pipeline suites and verify GREEN**

Run:

```bash
pnpm --filter @platform/api exec vitest run test/reflection/self-learning.service.spec.ts test/pipeline/proactive-thesis.integration.spec.ts
```

- [ ] **Step 6: Commit exact loss context**

```bash
git add apps/api/src/modules/reflection/application/self-learning.service.ts apps/api/src/modules/pipeline/application/pipeline-runner.service.ts apps/api/test/reflection/self-learning.service.spec.ts apps/api/test/pipeline/proactive-thesis.integration.spec.ts
git commit -m "fix: isolate critic losses to the exact thesis cohort"
```

---

### Task 5: Wire Authority and Add Real-Gate Pipeline Regression

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Modify: `apps/api/test/pipeline/proactive-thesis.integration.spec.ts`
- Modify: `apps/api/test/pipeline/proactive-lifecycle.repository.spec.ts` only if terminal attribution needs repository coverage

**Interfaces:**
- The proactive synthesized decision carries:

```ts
economicsAuthority: {
  probabilityAuthority: lifecycleAuthority.probabilityAuthority,
  lifecycleAction: lifecycleAuthority.action,
  sampleSize: lifecycleAuthority.sampleSize,
  empiricalWinProbability: lifecycleAuthority.empiricalWinProbability,
}
```

- Unavailable authority uses compatibility telemetry but never labels `0.5` as
  empirical probability.
- Terminal results preserve `thesisAttribution` after critic or downstream
  rejection.

- [ ] **Step 1: Write the failing real-gate regression**

In the proactive integration fixture, create a runner variant using real
`new DecisionRiskPolicyService()` and `new DecisionJudgeService()`. Keep only
external I/O dependencies mocked. With a valid immature thesis, assert:

```ts
expect(mockLiveTrading.assessPipelineDecision).toHaveBeenCalledOnce();
expect(mockLiveTrading.executePipeline).toHaveBeenCalledOnce();
expect(assessment.tradePlanContext.proactive.sizeFactor).toBeLessThanOrEqual(0.15);
```

- [ ] **Step 2: Run the single regression and verify RED**

Run with `-t "allows a valid immature exact cohort through real gates as a bounded probe"`.
Expected: risk or Judge blocks on placeholder economics.

- [ ] **Step 3: Wire economics authority into the synthesized decision**

Populate the explicit object from lifecycle authority before
`calibrateForExecution`. Replace the misleading unavailable
`expectedWinProbability: 0.5` compatibility value with a non-authoritative
schema-compatible value and rely exclusively on the explicit authority field
for provenance and gating.

- [ ] **Step 4: Run the regression and verify GREEN**

- [ ] **Step 5: Add safety control tests**

Using the same real-gate runner, prove independently that stale core data,
excessive spread, invalid geometry, and `SUPPRESSED` authority never call risk
assessment or execution. Assert unavailable authority never exceeds `0.15` even
when Judge, quant, and critic return no reductions.

- [ ] **Step 6: Add mature-cohort and attribution tests**

Assert exact `0.60` probability survives calibration, drives EV/PF, and still
passes ordinary thresholds. Force a critic cancellation and a downstream gate
rejection and assert persisted terminal results contain `thesisAttribution`.

- [ ] **Step 7: Run all proactive, gate, calibration, and reflection tests**

```bash
pnpm --filter @platform/api exec vitest run \
  test/pipeline/proactive-thesis.integration.spec.ts \
  test/pipeline/decision-judge.spec.ts \
  test/agents/calibration-authority.spec.ts \
  test/reflection/self-learning.service.spec.ts
```

- [ ] **Step 8: Commit pipeline integration**

```bash
git add packages/shared apps/api/src apps/api/test
git commit -m "fix: unblock safe proactive evidence collection"
```

---

### Task 6: Full Verification and Live-Readiness Report

**Files:**
- Create: `reports/2026-10-01-probe-economics-live-readiness.md`

**Interfaces:**
- Produces an evidence-backed report that separates verified code behavior from
  unverified external exchange behavior.

- [ ] **Step 1: Run the complete API suite**

Run: `pnpm --filter @platform/api test`

Record exact passed, skipped, todo, and failed counts.

- [ ] **Step 2: Run static verification sequentially**

Run each command separately to avoid `.next/types` generation races:

```bash
pnpm build
pnpm typecheck
pnpm lint
```

- [ ] **Step 3: Run enabled integration and E2E suites**

```bash
pnpm test:integration
pnpm test:e2e
```

If credentials or services are unavailable, record the exact failure or skip;
do not describe the system as LIVE-ready from unit evidence alone.

- [ ] **Step 4: Write the readiness report**

Include:

- commit and configuration tested;
- proof that real Risk/Judge allow a valid bounded probe;
- proof that all safety controls remain blocking;
- exact suite counts and commands;
- unresolved operational prerequisites;
- explicit `READY` or `NOT READY` status for SHADOW, DEMO, and LIVE separately.

- [ ] **Step 5: Run final diff and repository checks**

```bash
git diff --check
git status --short
```

- [ ] **Step 6: Commit the verification report**

```bash
git add reports/2026-10-01-probe-economics-live-readiness.md
git commit -m "docs: report probe economics live readiness"
```
