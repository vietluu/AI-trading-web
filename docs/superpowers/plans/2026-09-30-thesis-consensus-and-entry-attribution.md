# Thesis Consensus and Entry Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure proactive orders use a deterministically selected AI thesis aligned with the baseline direction and economics derived only from its exact lifecycle cohort.

**Architecture:** Add a pure thesis-selection domain function, enrich exact lifecycle profitability authority with empirical probability provenance, and wire both into the proactive pipeline before persistence and critic review. Persist JSON attribution with every evaluated proactive result while preserving the existing entry-zone, trigger, chase, protection, and account-risk gates.

**Tech Stack:** TypeScript 5.8, NestJS 11, Prisma 6, Zod 3, Vitest 3, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-30-thesis-consensus-and-entry-attribution-design.md`

## Global Constraints

- Do not lower `RISK_PER_TRADE`, leverage ceilings, exposure limits, or drawdown thresholds.
- Apply the behavior to proactive OBSERVE, SHADOW, and DEMO only; do not enable LIVE execution.
- Never use baseline or fallback probability as probability authority for an AI thesis.
- Preserve existing persisted-thesis entry-zone, trigger, expiry, chase-distance, invalidation, and exchange-protection checks.
- Use only outcomes whose `closedAt` is no later than the pinned snapshot cutoff.
- No database migration: attribution remains in existing JSON result fields.

---

### Task 1: Deterministic AI Thesis Candidate Selection

**Files:**
- Create: `apps/api/src/modules/agents/domain/thesis-candidate-selector.ts`
- Create: `apps/api/test/agents/thesis-candidate-selector.spec.ts`

**Interfaces:**
- Consumes: `TradeThesis`, `AnticipatoryMarketSnapshot`, `validateTradeThesis()`, and `calculateThesisNetR()`.
- Produces:

```ts
export type ThesisSelectionReason =
  | "ALIGNED_CANDIDATE_SELECTED"
  | "BASELINE_DECISION_WAIT"
  | "AI_BASELINE_DIRECTION_CONFLICT"
  | "NO_ALIGNED_EXECUTABLE_THESIS"
  | ThesisValidationReasonCode;

export interface ThesisCandidateSelection {
  selected?: TradeThesis;
  selectedCandidateIndex?: number;
  reason: ThesisSelectionReason;
  candidateCount: number;
  researchPreferredDirection: TradeThesis["direction"];
  baselineDirection: "LONG" | "SHORT" | "WAIT";
  directionAgreement: boolean;
  validations: ThesisValidationResult[];
}

export function selectTradeThesisCandidate(input: {
  preferred: TradeThesis;
  alternatives: TradeThesis[];
  baselineDirection: "LONG" | "SHORT" | "WAIT";
  snapshot: AnticipatoryMarketSnapshot;
  now: Date;
}): ThesisCandidateSelection;
```

- [ ] **Step 1: Write failing selector tests**

Cover five independent cases using `createBaseSnapshot()` and valid thesis fixtures:

```ts
it("rejects opposite AI and baseline directions", () => {
  const result = selectTradeThesisCandidate({
    preferred: shortThesis,
    alternatives: [],
    baselineDirection: "LONG",
    snapshot,
    now: new Date(cutoff),
  });
  expect(result).toMatchObject({
    selected: undefined,
    reason: "AI_BASELINE_DIRECTION_CONFLICT",
    directionAgreement: false,
  });
});

it("selects a valid aligned alternative over an opposite preferred thesis", () => {
  const result = selectTradeThesisCandidate({
    preferred: shortThesis,
    alternatives: [longThesis],
    baselineDirection: "LONG",
    snapshot,
    now: new Date(cutoff),
  });
  expect(result.selected).toEqual(longThesis);
  expect(result.selectedCandidateIndex).toBe(1);
});
```

Also assert baseline `WAIT`, all-invalid candidates, and ranking by net R → evidence count → missing-evidence count → original order.

- [ ] **Step 2: Run the selector test and verify RED**

Run:

```bash
pnpm --filter @platform/api exec vitest run test/agents/thesis-candidate-selector.spec.ts
```

Expected: FAIL because `thesis-candidate-selector.ts` does not exist.

- [ ] **Step 3: Implement the pure selector**

Use `[preferred, ...alternatives]`, validate each candidate once, filter to executable aligned candidates, calculate net R from the pinned snapshot, and use a stable decorated sort. Do not mutate candidate objects.

- [ ] **Step 4: Run selector tests and verify GREEN**

Run the command from Step 2. Expected: all selector tests pass.

- [ ] **Step 5: Commit the selector**

```bash
git add apps/api/src/modules/agents/domain/thesis-candidate-selector.ts apps/api/test/agents/thesis-candidate-selector.spec.ts
git commit -m "fix: select proactive theses by deterministic consensus"
```

---

### Task 2: Exact Lifecycle Probability Authority and Recent-Loss Context

**Files:**
- Modify: `apps/api/src/modules/reflection/domain/thesis-cohort.ts`
- Modify: `apps/api/src/modules/reflection/application/self-learning.service.ts`
- Modify: `apps/api/test/reflection/thesis-cohort.spec.ts`
- Modify: `apps/api/test/reflection/self-learning.service.spec.ts`

**Interfaces:**
- Extends `ProfitAuthorityResult` with:

```ts
probabilityAuthority: "EXACT_LIFECYCLE" | "UNAVAILABLE";
empiricalWinProbability: number | null;
```

- Extends object-form `ThesisCohortKeyParams` with optional `provider?: string`.
  Keep the existing serialized cohort-key parser backward compatible; the
  proactive pipeline uses object form so provider can participate in the exact
  query without reinterpreting stored legacy keys.

- Produces:

```ts
export interface RecentThesisLossSummary {
  direction: "LONG" | "SHORT";
  setup?: string;
  regime?: string;
  netR: number;
  exitReason?: string;
  entryPrice: number;
  exitPrice: number | null;
}

async recentLossesForThesis(
  params: Pick<ThesisCohortKeyParams, "symbol" | "timeframe">,
  options: { asOf: Date; take?: number },
): Promise<RecentThesisLossSummary[]>;
```

- [ ] **Step 1: Write failing probability-authority domain tests**

Assert that 29 exact finalized outcomes return:

```ts
expect(result).toMatchObject({
  probabilityAuthority: "UNAVAILABLE",
  empiricalWinProbability: null,
});
```

Assert that 30 outcomes with 18 wins return `EXACT_LIFECYCLE` and `0.6`, including when the authority remains probe-only because another profitability condition fails.

Add a service test proving object-form exact authority includes `provider` and
`configurationHash` in the Prisma query, so outcomes from another exchange or
configuration cannot supply probability authority.

- [ ] **Step 2: Run the domain tests and verify RED**

```bash
pnpm --filter @platform/api exec vitest run test/reflection/thesis-cohort.spec.ts
```

Expected: FAIL because the probability provenance fields are absent.

- [ ] **Step 3: Implement exact probability provenance**

Derive probability from the deduplicated finalized exact cohort already used by `evaluateProfitAuthority()`. Expose it only when `sampleSize >= fullSizeMinimumSamples`; otherwise return `null` with `UNAVAILABLE` for every action, including suppression with fewer than 30 samples.

Add provider matching to exact-cohort filtering and the Prisma query when the
object-form key supplies it. Do not change parsing semantics for existing
serialized keys.

- [ ] **Step 4: Write failing recent-loss query tests**

Assert Prisma receives all of:

```ts
where: {
  status: "FINALIZED",
  symbol: "BTC-USDT",
  timeframe: "15m",
  netR: { lt: 0 },
  closedAt: { lte: asOf },
}
```

Assert `orderBy: { closedAt: "desc" }`, `take: 5`, and bounded summaries containing no arbitrary lifecycle metadata.

- [ ] **Step 5: Run the service tests and verify RED**

```bash
pnpm --filter @platform/api exec vitest run test/reflection/self-learning.service.spec.ts
```

Expected: FAIL because `recentLossesForThesis()` does not exist.

- [ ] **Step 6: Implement the query and mapping**

Default `take` to 5 and clamp it to `1..5`. Map decimal fields with `Number()` and omit fields not declared by `RecentThesisLossSummary`.

- [ ] **Step 7: Run both reflection suites and verify GREEN**

```bash
pnpm --filter @platform/api exec vitest run test/reflection/thesis-cohort.spec.ts test/reflection/self-learning.service.spec.ts
```

- [ ] **Step 8: Commit lifecycle authority changes**

```bash
git add apps/api/src/modules/reflection/domain/thesis-cohort.ts apps/api/src/modules/reflection/application/self-learning.service.ts apps/api/test/reflection/thesis-cohort.spec.ts apps/api/test/reflection/self-learning.service.spec.ts
git commit -m "fix: bind thesis probability to exact lifecycle evidence"
```

---

### Task 3: Wire Consensus, Critic Context, and Unmixed Economics into the Pipeline

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Modify: `apps/api/test/pipeline/proactive-thesis.integration.spec.ts`

**Interfaces:**
- Consumes `selectTradeThesisCandidate()`, enriched `ProfitAuthorityResult`, and `recentLossesForThesis()`.
- Produces a JSON-compatible `thesisAttribution` in proactive evaluated results.

- [ ] **Step 1: Write a failing direction-conflict integration test**

Make researcher return a valid SHORT thesis while baseline returns LONG. Assert:

```ts
expect(await pipelineRunner.run(makeJob())).toEqual({
  outcome: "SKIPPED",
  reason: "AI_BASELINE_DIRECTION_CONFLICT",
});
expect(mockCritic.reflect).not.toHaveBeenCalled();
expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
```

Also assert the terminal run result contains baseline direction, research preferred direction, candidate count, and rejection reason.

- [ ] **Step 2: Run the conflict test and verify RED**

```bash
pnpm --filter @platform/api exec vitest run test/pipeline/proactive-thesis.integration.spec.ts -t "direction conflict"
```

Expected: FAIL because the current pipeline continues with the SHORT thesis.

- [ ] **Step 3: Write failing aligned-alternative and loss-context tests**

Return an opposite preferred thesis and aligned alternative. Assert the aligned candidate is persisted and passed to critic. Mock two recent losses and assert `critic.reflect()` receives their formatted summaries. Add a query-failure case asserting the critic receives `recentLosses: []` and deterministic processing continues.

- [ ] **Step 4: Write a failing unmixed-economics test**

Give baseline probability `0.91`, then return immature lifecycle authority with `empiricalWinProbability: null`. Capture the decision sent to risk and assert its probability authority is unavailable and its expected value is not calculated from `0.91`.

Add a mature exact case with probability `0.6` and thesis net R `2`; assert expected value equals `0.8` and estimated profit factor equals `3`.

- [ ] **Step 5: Reorder and implement the proactive flow**

Within the proactive branch:

1. Generate researcher candidates.
2. Produce baseline.
3. Run `selectTradeThesisCandidate()`.
4. Persist only the selected thesis, or finalize with the selector reason.
5. Fetch bounded recent losses with `asOf: snapshot.sourceDataCutoff`; catch, log, and use `[]` on query failure.
6. Review and validate the selected thesis.
7. Evaluate exact lifecycle authority.
8. Build proactive economics from exact empirical probability only.

Pass `provider` and `configurationHash: context.configHash` in the object-form
cohort parameters. Keep `executionPolicyVersion` unchanged so historical policy
partitioning still applies.

For unavailable probability, retain the baseline object's unrelated market fields but set proactive probability telemetry to neutral values and rely on lifecycle `PROBE_ONLY`; do not copy baseline probability into the proactive thesis economics.

- [ ] **Step 6: Add attribution to evaluated and terminal results**

Create one local `thesisAttribution` object and attach it to the run result. Set `entrySource` from the selected thesis `decisionSource`; set `criticRecentLossCount` from the bounded list; update probability fields after lifecycle evaluation.

- [ ] **Step 7: Run proactive integration tests and verify GREEN**

```bash
pnpm --filter @platform/api exec vitest run test/pipeline/proactive-thesis.integration.spec.ts
```

- [ ] **Step 8: Commit pipeline integration**

```bash
git add apps/api/src/modules/pipeline/application/pipeline-runner.service.ts apps/api/test/pipeline/proactive-thesis.integration.spec.ts
git commit -m "fix: enforce proactive thesis consensus and attribution"
```

---

### Task 4: Regression Verification and Documentation

**Files:**
- Modify only if a discovered regression requires a focused fix and a preceding failing test.

**Interfaces:**
- Verifies the complete proactive decision → risk → execution contract.

- [ ] **Step 1: Run focused safety suites**

```bash
pnpm --filter @platform/api exec vitest run \
  test/agents/thesis-candidate-selector.spec.ts \
  test/reflection/thesis-cohort.spec.ts \
  test/reflection/self-learning.service.spec.ts \
  test/pipeline/proactive-thesis.integration.spec.ts \
  test/pipeline/proactive-joined-execution.spec.ts \
  test/pipeline/entry-drift-reassessment.spec.ts \
  test/risk/risk-engine.spec.ts
```

Expected: all pass.

- [ ] **Step 2: Run static verification**

```bash
pnpm --filter @platform/api typecheck
pnpm --filter @platform/api lint
```

Expected: both exit 0.

- [ ] **Step 3: Run the complete API suite**

```bash
pnpm --filter @platform/api test
```

Expected: all non-skipped tests pass with no new todo tests.

- [ ] **Step 4: Inspect the final diff**

```bash
git diff --check
git status --short
git diff --stat HEAD~3..HEAD
```

Confirm no risk-limit configuration changed and no LIVE authorization was added.

- [ ] **Step 5: Commit any verification-only documentation adjustment**

Skip this commit when verification required no file changes. If documentation changed, stage only that file and use:

```bash
git commit -m "docs: record proactive consensus verification"
```
