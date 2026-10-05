# Production AI audit and local remediation — 2026-10-04

## Scope and evidence

Production was inspected through the database configured in the local environment. Every audit query ran in a READ ONLY transaction, with one connection and an eight-second statement timeout. No deployment, orders, production configuration changes or historical backfills were performed. SSH authentication failed; database reads succeeded. Credentials and raw prompts are not included here.

The first aggregates were collected around 11:10–11:17 UTC; follow-up snapshot/ledger checks were later on the same date. Rolling windows therefore differ slightly. These are observations of the existing production build, **not results of the uncommitted local fixes**.

## Verified findings

| Area | Production evidence | Interpretation |
|---|---|---|
| Provider selection, first 24-hour window | 2,095 failed Ollama histories; failures for Gemini TTS/image/preview models; 11 successful robotics-model histories | Discovery/fallback did not enforce a text-model allowlist. |
| Gemini accounting, first 24-hour window | 501 successful `gemini-3.1-flash-lite` histories, 3,892,697 tokens, all estimated costs zero | Model price metadata is zero, not evidence of free billing. |
| All-history accounting, first observation | 30,421 histories, 103,584,671 tokens; 102,706,574 successful tokens priced at zero; recorded estimated cost 0.293591 | Historical cost totals are materially incomplete. No invoice-level reconstruction performed. |
| Researcher, first 24-hour window | 107 FAILED `trade-researcher` runs: 73 quota/cooldown, 13 DB pool timeouts, 19 stale/unavailable evidence, 2 empty JSON | AI transport success does not imply a usable trading thesis. |
| Database | 211 failed agent runs mention pool timeout; messages show connection limit 3 and timeout 10 seconds. PostgreSQL max_connections=100; observation-time activity was low | Historical application-pool starvation is verified. Current idle capacity does not prove the contention source or absence of slow queries under load. |
| Cutoff consistency | Follow-up aggregate: 137 researcher snapshots in the rolling 24-hour window had execution reason `EXECUTION_CONTEXT_AFTER_CUTOFF` | The runner fetched a current quote then rebuilt research using the old opportunity cutoff, making execution evidence invalid by construction. |
| Lifecycle, first observation | 24 theses, all WAIT / AI_WITH_RULES_FALLBACK; 14 reviews, 0 execution plans, 0 outcomes | No demonstrated successful end-to-end proactive trading lifecycle. WAIT does not justify fabricating a plan or outcome. |
| Agent recovery | Numerous active-state rows older than 15 minutes, including 50 MARKET_ANALYST and 42 SENTIMENT_ANALYST RUNNING rows | Stale statuses survive failure handling; historical cleanup/reconciliation remains outstanding. |
| Ledger, follow-up 30-day window | 12 complete-source DEMO closed trades, aggregate stored netPnl=-7.76057001; no PRODUCTION group returned | Insufficient and negative aggregate evidence; not a measurement of the new strategy/configuration. |
| Live approval | One self-learning configuration, zero approved version/hash pairs | No basis to declare LIVE ready. |

## Local corrections

1. Orchestrator execute and stream select only `GEMINI / gemini-3.1-flash-lite`, regardless of caller overrides or legacy preferences. No dynamic model discovery in request routing, no Anthropic/Ollama fallback. Missing Gemini credentials fail closed. Existing auth/quota/availability handling remains.
2. Configuration responses agree with that allowlist even when old deployment defaults name other providers/models.
3. Gemini text estimated cost uses standard paid rates: $0.25 input and $1.50 output per million tokens; output includes thinking tokens. This is a conservative usage estimate, not an invoice: free-tier/cached-token discounts and historical missing usage are not reconstructed. Source: [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).
4. Researcher audit rows now persist response estimatedCost instead of silently taking the database default zero.
5. Gemini requests now transmit the provided JSON schema through responseJsonSchema; thesis alternatives carry the same required field schema as the preferred thesis, not merely a prose description. Source: [Google GenerateContent reference](https://ai.google.dev/api/generate-content).
6. Prisma uses an explicit default pool of ten connections per API process, configurable from 1–20. Explicit URL connection_limit/pool_timeout are preserved. Compose forwards pool size and Gemini concurrency; pipeline default concurrency is two. This is a bounded mitigation requiring load verification, not proof that all connection-pool failures are eliminated. Account for all replicas/processes before changing deployment capacity.
7. Proactive decisions build a new observation after quote acquisition, retaining the original opportunity identifiers/cutoff in job parameters. No quote timestamp is backdated and the builder's future-data rejection remains intact.
8. Corrected a regression in the earlier event-only work: opportunity-triggered proactive delivery now uses EVENT rather than SCHEDULE, so disabling periodic AI does not reject that delivery API.
9. Independent review caught a stored-context replay hazard in the cutoff change. Proactive stored-context replay now fails closed before live evidence acquisition, AI research or execution until exact historical decision snapshots can be restored. The failing regression previously reached ORDER_SUBMITTED with test exchange doubles.
10. The realtime event dispatcher now observes the pinned closed-candle snapshot first and schedules only `proactive-thesis` opportunities that reach `WATCHING`. It no longer starts `FULL_ANALYSIS_DECISION`, closing the path that could bypass the mandatory thesis/review/plan lifecycle. News and macro events resolve the current closed 15-minute anchor; market events retain their originating indicator cutoff.
11. Runner, cancellation and asynchronous-enqueue status changes now share one database transaction with a compare-and-set on the prior state. A failed or racing update cannot leave a misleading transition row. Existing historical stale rows were not modified.
12. Proactive queue redelivery retains the `EVENT` trigger and original event expiry/evidence. Event freshness is checked again after opportunity observation, so slow deterministic work cannot enqueue an already-expired event.

## Remaining blockers / deliberately not claimed complete

- Pool saturation mitigation needs deployed load/latency evidence. Atomic transition persistence is corrected locally, but ownership-safe recovery of historical orphan rows still requires a durable run lease/heartbeat; no old run states were silently repaired.
- The cutoff correction does not waive quote/indicator freshness. Quote lifetime versus AI latency, and mixed-frequency execution/ATR freshness, still need end-to-end observation.
- Stored-context proactive replay is explicitly blocked; restoring historical replay functionality requires exact pinned-snapshot handling. It cannot serve as paper/shadow performance evidence in the meantime.
- No historical cost backfill was performed. Usage missing from previous telemetry cannot be reconstructed exactly from the token total alone.
- No new live-provider smoke test, shadow/paper sample collection, configuration-matched expectancy or mark-to-market drawdown validation was performed.
- Existing strict live eligibility policy requires at least 100 shadow and 100 canary trades, positive expectancy, PF≥1.3, Sharpe≥0.5, OOS accuracy≥55%, drawdown≤10%, plus explicit approval. No gate was relaxed or mode enabled.

## Verification

- Regression tests were first observed failing for whitelist/stream routing, zero-cost thinking-token accounting, omitted Gemini schema, missing researcher cost persistence, implicit pool sizing, mismatched opportunity/quote cutoff, and event-only proactive delivery.
- Full API suite after event-to-lifecycle, retry and atomic-transition fixes: 213 files passed, five skipped; 1,505 tests passed, six skipped, two TODO.
- API TypeScript check passed.
- Scoped lint for AI/provider/registry/config/researcher/pool changes and the new tests passed.
- Independent scoped review identified the stored replay issue; reviewer confirmed the fail-closed guard resolves it. This review does not certify the earlier event architecture or operational readiness.
- No commit, push or deployment performed.

**Release verdict: not ready for LIVE or an unqualified production-complete claim.** The local event-to-lifecycle gap is corrected, but deployment validation, ownership-safe orphan recovery, shadow/paper evidence and configuration-matched performance gates remain explicit follow-up work; green tests do not replace them.
