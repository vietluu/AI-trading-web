# Production Entry Bottleneck Remediation Design

## Goal

Remove the verified production-data bottlenecks that prevent valid demo entries while preserving every existing fail-closed risk invariant. The change must not lower confidence, calibration, geometry, risk, cooldown, or live-trading gates.

## Evidence and Scope

The production database audit at `2026-09-17T15:49Z` showed four distinct issues:

1. An OKX demo order reached the exchange with protection geometry rejected against the effective primary order price.
2. Directional decisions with confidence 85 were persisted beside an execution context whose action was `WAIT`, producing misleading decision telemetry even though execution was correctly blocked.
3. Completed pipeline runs retained untouched step rows in `PENDING` state after early exits.
4. The opportunity watcher persisted hundreds of opportunities, but the governed proactive research lifecycle persisted no theses, reviews, execution plans, or shadow plans.

The first three are bounded correctness fixes. The fourth is a lifecycle integration correction: watcher observations must schedule the existing `proactive-thesis` pipeline rather than create a second research or execution path.

## Safety Invariants

- AI output never submits an order directly.
- An execution decision is actionable only after execution-readiness, quant, judge, risk, and exchange preflight pass.
- Stop loss and take profit geometry is validated against the exact normalized entry price sent to the exchange.
- Production exchange connectivity and live trading remain disabled unless existing explicit runtime and operator gates enable them.
- No confidence or risk threshold is reduced.
- Duplicate closed-candle observations cannot create duplicate theses, plans, or orders.
- Early termination must preserve the canonical blocking reason.

## Design

### 1. Final Order Protection Preflight

Keep the existing domain preflight as the single geometry authority, but invoke it at the last command boundary after all exchange-specific transformations: instrument lookup, tick rounding, maker-first price selection, fresh ticker retrieval, and any drift reassessment.

The effective primary order price, normalized stop loss, and normalized take profit returned by preflight become the values passed to the OKX adapter. A rejection is persisted as a local execution failure with the canonical preflight reason; the exchange API is not called. Tests reproduce the rejected ZRO long geometry and cover both BUY and SELL commands after price replacement.

### 2. Separate Directional Thesis from Executable Decision

Retain the model's directional opinion and confidence inside `candidateDecision`. The top-level pipeline decision represents executable intent only. When execution-readiness reports `ENTRY_ACTION_NOT_EXECUTABLE`, the top-level decision is `WAIT`, `actionable` is false, and the blocking gate remains `EXECUTION_READINESS`.

Telemetry must expose both concepts without destroying evidence:

- `candidateDecision.decision` and `candidateDecision.confidence`: directional thesis.
- top-level `decision`: executable decision.
- `result.actionable`: whether downstream risk/execution may run.

No artificial confidence reduction is introduced. Consumers must not infer actionability from candidate confidence alone.

### 3. Terminal Pipeline Step Reconciliation

Add one repository operation that transitions only remaining `PENDING` or `RUNNING` steps to `SKIPPED` when a run terminates normally before all steps execute. Store the canonical run reason in `errorCode` or a structured output reference according to the existing step schema; never overwrite `COMPLETED` or `FAILED` steps.

Every early-return path uses a shared terminal-run helper that updates the run and reconciles its steps in one logical operation. Failure paths continue to mark the active failing step as `FAILED`; untouched later steps become `SKIPPED`.

### 4. Opportunity-to-Proactive Scheduling Bridge

The opportunity watcher remains responsible only for deterministic observation and state transitions. It must not call the researcher, critic, risk engine, or exchange directly.

When an idempotent transition first enters `WATCHING`, publish or enqueue one `proactive-thesis` pipeline run using the persisted opportunity/snapshot identity and pinned `sourceDataCutoff`. Duplicate observation of the same cutoff must not enqueue another run. The proactive runner continues to own thesis creation, critic review, validation, and any mode-governed execution.

The bridge is enabled only for declared proactive modes:

- `OBSERVE`: persist thesis/review evidence; never submit an order.
- `SHADOW`: persist thesis/review and eligible shadow plan; never submit an exchange order.
- `DEMO`: retain existing verified-demo-connection, risk, and execution gates.

If the required worker or dependency is unavailable, persist a canonical scheduling failure or retryable state instead of silently allowing the opportunity to expire. Existing opportunity and evaluation idempotency keys remain the deduplication authority.

## Error Handling and Observability

- Local protection rejection records the effective entry, normalized protection values, side, symbol, and canonical reason without secrets.
- Pipeline summaries report candidate direction separately from executable decision.
- Terminal step reconciliation makes run and step status counts consistent.
- Opportunity transitions record whether proactive scheduling was created, reused, or failed.
- Audit checks fail when recent opportunities enter `WATCHING` but no corresponding proactive lifecycle artifact or explicit scheduling failure exists. Empty downstream tables no longer count as a healthy pass when eligible watcher transitions exist.

## Testing

Implementation follows test-driven development:

1. Exchange tests reproduce protection inversion after final price normalization and prove the adapter is not called.
2. Pipeline tests prove a high-confidence directional thesis with `action=WAIT` persists top-level `WAIT` and does not reach risk assessment.
3. Pipeline runtime tests prove early completion leaves zero `PENDING` or `RUNNING` steps and preserves completed steps.
4. Opportunity watcher integration tests prove the first `WATCHING` transition schedules exactly one proactive run, duplicate cutoffs reuse it, and invalid/expired opportunities schedule nothing.
5. Mode tests prove `OBSERVE` and `SHADOW` cannot submit exchange orders and `DEMO` retains all connection and risk gates.
6. The focused suites run first, followed by API typecheck and the complete API test suite.

## Rollout and Verification

Deploy without changing trading flags. After deployment, verify over at least one complete 15-minute schedule interval:

- no newly completed run contains `PENDING` or `RUNNING` steps;
- `ENTRY_ACTION_NOT_EXECUTABLE` runs retain candidate evidence but expose top-level `WAIT`;
- new `WATCHING` transitions have a linked/reused proactive run or an explicit scheduling failure;
- eligible `OBSERVE`/`SHADOW` runs create governed artifacts without exchange orders;
- no new OKX invalid-protection request reaches the exchange.

Live or production trading enablement is explicitly outside this change.
