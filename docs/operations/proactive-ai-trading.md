# Proactive AI Trading: Operations & Governance Runbook

This runbook establishes the operating principles, release stages, monitoring protocols, rollback procedures, reconciliation requirements, and manual operator governance gates for the Proactive AI Trading lifecycle on the platform.

---

## 1. Core Operating Principles & Architecture Governance

The Proactive AI Trading subsystem identifies anticipatory market setups (e.g. range squeezes, accumulation bases, pre-breakout volume build-up, and trend exhaustion) before major expansion occurs.

To ensure capital safety and institutional soundness, the platform enforces strict architectural boundaries:

1. **AI Never Directly Submits Orders:** An AI thesis is strictly an advisory proposal. Execution requires passage through a chain of deterministic gates:
   $$\text{Market Snapshot} \longrightarrow \text{AI Researcher} \longrightarrow \text{Critic} \longrightarrow \text{Cohort Evidence} \longrightarrow \text{Risk Engine} \longrightarrow \text{Trade Plan} \longrightarrow \text{Exchange}$$
2. **Deterministic Risk Authority:** The Risk Engine retains final, non-overridable authority over order sizes, leverage, daily loss limits, maximum exposure, and mandatory stop-loss protection. An AI thesis can reduce size or cancel, but can never expand size or loosen risk limits.
3. **Mandatory Protective Stops:** Every single executed position must have an explicit, exchange-verified stop-loss order placed immediately upon fill. Any execution lacking protection is treated as a fatal system defect.
4. **Lifecycle Evaluation vs. Directional Predictions:** The system evaluates complete execution lifecycles (including fees, slippage, funding, limit TTL, adverse gaps, partial takes, and trailing stops) rather than fixed-horizon binary accuracy.
5. **Frozen Artifact Promotion:** Models, prompts, configurations, and calculation algorithms must be cryptographically hashed (SHA-256) and verified on untouched forward samples before promotion.

---

## 2. Feature Modes & Promotion Lifecycle Stages

The promotion state machine implements five deterministic stages governed by `ModelPromotionPolicy`:

```
┌─────────┐      ┌────────┐      ┌─────────────┐      ┌──────────┐      ┌──────────────────────┐
│ OBSERVE │ ───> │ SHADOW │ ───> │ DEMO_CANARY │ ───> │ ELIGIBLE │ ───> │ APPROVED_LIVE_CANARY │
└─────────┘      └────────┘      └─────────────┘      └──────────┘      └──────────────────────┘
                     ▲                  │                   │                       │
                     └──────────────────┴───────────────────┴───────────────────────┘
                                       (Automatic Rollback on Breach)
```

### Stage 1: `OBSERVE`
- **Purpose:** Telemetry validation, prompt calibration, schema verification, and latency measurement without any trade execution.
- **Behavior:** Constructs `AnticipatoryMarketSnapshot`s and persists `TradeThesis` records with status `WATCHING` or `CANCELLED`.
- **Trading Connectivity:** No orders are submitted to any demo, paper, or live exchange account.
- **Advancement Criteria to `SHADOW`:**
  - Untouched forward sample IDs initialized without duplicates or training set contamination.
  - Zero schema validation errors across snapshot and thesis payloads.

### Stage 2: `SHADOW`
- **Purpose:** Continuous counterfactual portfolio replay of AI recommendations under realistic execution conditions.
- **Behavior:** Executes `replayExecution()` against timestamped closed candles and order books. Simulates next-observation entry, limit TTL cancellations, spread, fees, slippage, funding rates, adverse gap fills, and Position Copilot actions.
- **Trading Connectivity:** Simulated in-memory portfolio; no exchange order submission.
- **Advancement Criteria to `DEMO_CANARY`:**
  - Forward sample size $\ge 50$ unique finalized trade lifecycles.
  - Lifecycle expectancy $\text{Net } R > 0.0$.
  - Profit Factor $\ge 1.30$.
  - Mark-to-market drawdown $\le 10.0\%$.
  - Zero protection omissions (100% stop-loss compliance).
  - Chase rate $\le 25.0\%$.
  - Cohort stability score $\ge 0.60$.
  - Drift score $\le 0.20$.

### Stage 3: `DEMO_CANARY`
- **Purpose:** Real-time execution against verified paper/demo exchange accounts (e.g. Binance Futures Testnet / OKX Demo) to evaluate WebSocket order routing, real network latencies, and exchange order lifecycle management.
- **Behavior:** Executes staged entry:
  - **Probe Stage:** 25%–50% of nominal risk on setup detection.
  - **Confirmation Stage:** Remaining 50%–75% added only upon deterministic confirmation transition and within original risk budget.
- **Trading Connectivity:** Demo/Paper exchange only. Live production exchange connection remains strictly disabled.
- **Advancement Criteria to `ELIGIBLE`:**
  - Demo canary sample meets all metric gates without manual intervention.
  - Candidate configuration hash is frozen in audit ledger.

### Stage 4: `ELIGIBLE`
- **Purpose:** Candidate configuration is cryptographically locked, audited, and held in an immutable state pending formal human operator review.
- **Behavior:** The candidate model and strategy version continue running in paper/shadow evaluation while awaiting signoff.
- **Trading Connectivity:** **STRICTLY BLOCKED FROM LIVE.** The system will refuse any live execution attempt in this state.
- **Advancement Criteria to `APPROVED_LIVE_CANARY`:**
  - Requires explicit two-step operator governance signoff (see Section 6).

### Stage 5: `APPROVED_LIVE_CANARY`
- **Purpose:** Real capital execution on production exchange with tightly bounded canary risk.
- **Behavior:** Begins with **probe-only** sizing (typically $\le 0.25\%$ to $0.5\%$ portfolio risk per trade).
- **Trading Connectivity:** Production exchange connection enabled only when environment variable `LIVE_TRADING_ENABLED=true` and explicit operator signoff record matches the frozen configuration hash.
- **Automated Demotion:** Any single gate breach or circuit breaker immediately reverts the stage to `SHADOW`.

---

## 3. Monitoring & Operational Dashboards

Operators and on-call engineers must monitor real-time dashboards partitioned into four critical pillars:

### 3.1. Portfolio & Continuous Equity Curve Dashboard
- **Continuous Mark-to-Market Equity:** Real-time account equity marked at every quote/candle, capturing intra-trade unrealized drawdowns.
- **Peak-to-Trough Drawdown Gauge:** Current drawdown vs. the 10.0% circuit-breaker ceiling.
- **Portfolio Concurrency & Exposure:** Total open positions, directional balance (long vs. short exposure), and correlated crypto beta exposure.

### 3.2. Protection & Risk Compliance Dashboard
- **Protection Integrity (Zero Omission Watcher):** Displays all open positions with their corresponding exchange-verified stop-loss order ID and trigger price. Any position lacking an exchange stop raises an immediate P0 alert.
- **Stop Tightening & Trailing Stop Log:** Real-time tracking of Position Copilot stop-tightening events (e.g. break-even movement at $1.5R$, trailing ATR stops). Stops may only tighten; loosening is blocked by code.

### 3.3. Critic Lift & Cohort Calibration Telemetry
- **Paired Lift Telemetry:**
  - $\text{Total Avoided Loss } (R)$: Losses saved by Critic blocking or downsizing toxic setups.
  - $\text{Total Missed Win } (R)$: Winners forgone due to Critic false positives.
  - $\text{Net Critic Lift } (R) = \text{Avoided Loss } - \text{Missed Win}$.
- **Uncertainty Intervals:** 95% Confidence Interval and Bootstrap standard error for net expectancy and critic lift.
- **Cohort Health Breakdown:** Realized Net $R$ and sample counts segmented by `symbol|timeframe|regime|direction|setup|policyVersion`. Flags cohorts entering fallback sizing or approaching negative expectancy.

### 3.4. System Health & Rejection Audit Dashboard
- **Snapshot Data Freshness:** Age of order book, mark price, liquidity sweeps, and squeeze metrics. Alerts if age exceeds 300,000 ms.
- **Gate Rejection Breakdown:** Rejections categorized by reason:
  - `MAX_PORTFOLIO_EXPOSURE_EXCEEDED`
  - `MAX_POSITIONS_PER_DIRECTION_EXCEEDED`
  - `CHASE_DISTANCE_EXCEEDED` (entry beyond 0.6–0.8 ATR)
  - `RELIABLE_NEGATIVE_EXACT_COHORT`
  - `TOO_LATE_SIGNAL`

---

## 4. Automated Rollback Procedures & Circuit Breakers

The system implements automated, non-negotiable circuit breakers that revert any active stage (`APPROVED_LIVE_CANARY` or `DEMO_CANARY`) back to `SHADOW`:

| Trigger Condition | Threshold | Automated System Action | Operator Notification |
|---|---|---|---|
| **Mark-to-Market Drawdown** | $> 10.0\%$ | Immediate rollback to `SHADOW`; cancel all pending entries; trigger orderly position exit | P0 Page |
| **Protection Omission** | $> 0$ trades without stop | Immediate rollback to `SHADOW`; emergency protection recovery placed at market | P0 Page |
| **Model Drift** | Drift score $> 0.20$ | Immediate rollback to `SHADOW`; revert to pure deterministic rules fallback | P1 Alert |
| **Negative Cohort Expectancy** | Mean Net $R < 0.0$ on mature cohort ($N \ge 20$) | Block setup for that specific cohort; revert candidate to `SHADOW` if widespread | P1 Alert |
| **Daily Loss Circuit Breaker** | Realized daily loss $> 5.0\%$ | Trading halted for remainder of UTC day; stage locked | P0 Page |
| **Exchange Latency / Timeout** | API timeout $> 5,000\text{ ms}$ or WebSocket stale $> 30\text{s}$ | Fail-closed; freeze execution; retain position management only | P1 Alert |

### Rollback Execution Mechanics
When `evaluatePromotionTransition()` detects a failing metric gate from an active canary stage:
1. `PromotionTransitionResult` sets `toStage: 'SHADOW'` and `isRollback: true`.
2. All pending entry orders associated with the candidate version are cancelled immediately via the exchange gateway.
3. Open positions remain governed by the deterministic Position Manager safety baseline (tightening stops, trailing, and take-profit targets). No unplanned market dumps are executed unless the hard daily loss limit is breached.
4. An immutable audit record is written to the database capturing the exact failure reasons (e.g. `['DRAWDOWN_BREACH']`, `['PROTECTION_FAILURE']`).

---

## 5. Reconciliation & Audit Trails

To guarantee compliance and eliminate unaccounted drift between internal state and exchange balances, the platform runs automated continuous reconciliation:

### 5.1. Immutable Audit Ledger
The platform schema records immutable, append-only domain entities:
- `AnticipatoryMarketSnapshot`: Input market condition, orderbook depth, squeeze state, liquidity sweep indicators, and source timestamps.
- `TradeThesis`: Proposed directional setup, entry zone, trigger conditions, invalidation price, mandatory stop-loss, targets, and expiry.
- `ThesisReview`: Critic and Judge evaluations, confidence scores, evidence references, and sizing recommendations.
- `ExecutionPlanVersion`: Concrete order parameters, limits, TTL, and staged entry specifications.
- `TradeLifecycleOutcome`: Immutable trade resolution record, recording opened at, closed at, gross PnL, signed maker/taker fees, signed funding payments, net PnL, net $R$, and peak intra-trade drawdown.

Every record persists:
- `sourceDataCutoff` (Point-in-time timestamp)
- `schemaVersion` & `calculationVersion`
- `configurationHash` (SHA-256)
- `modelProvider` & `promptVersion`

### 5.2. Periodic Exchange Reconciliation Job
- Runs every 60 seconds (or immediately following any WebSocket reconnect).
- Queries active positions, pending orders, and wallet balance from the exchange REST API.
- Compares against the PostgreSQL and Redis position ledger.
- **Discrepancy Handling:**
  - **Phantom Order / Position on Exchange:** Automatically adopts the position into the safety manager and places an emergency stop-loss.
  - **Missing Stop on Exchange:** Places immediate protective stop-loss based on stored `finalStopLoss`.
  - **Balance Mismatch:** Flags reconciliation discrepancy, pauses new order entries, and alerts operations.

---

## 6. Step-by-Step Operator Manual Runbook

Transitioning a candidate model to production is a **deliberate human-in-the-loop procedure**. It cannot be automated by code or scheduled jobs.

### Phase 1: Reviewing Frozen Candidate in `ELIGIBLE` State
1. Verify that the model candidate has reached `ELIGIBLE` status in the self-learning dashboard.
2. Inspect the headline metrics on untouched forward samples:
   - Sample size $\ge 50$
   - Lifecycle Net $R > 0.0$
   - Profit Factor $\ge 1.30$
   - Mark-to-market drawdown $\le 10.0\%$
   - Protection omissions $= 0$
   - Paired critic lift is positive and statistically significant (check 95% uncertainty interval).

### Phase 2: Verifying Configuration Hash & Evidence Provenance
1. Obtain the frozen configuration hash from the evaluation report:
   ```bash
   pnpm --filter @platform/api exec ts-node scripts/verify-candidate-hash.ts --candidate-version <VERSION>
   ```
2. Confirm the SHA-256 hash matches the prompt version, model identifier, risk thresholds, and execution assumptions.

### Phase 3: Executing Operator Approval Record
1. The operator signs off by submitting an immutable `OperatorApprovalRecord`:
   ```json
   {
     "operatorId": "operator-username@platform.local",
     "approvedAt": "2026-09-11T12:00:00.000Z",
     "configurationHash": "proactive-frozen-v1-hash-abc123",
     "confirmed": true,
     "notes": "Forward replay and demo canary passed all gates. Net lift positive. Approved for live canary probe sizing only."
   }
   ```
2. The platform verifies that `operatorApproval.configurationHash === candidate.configurationHash`. Any discrepancy will reject the transition with `OPERATOR_APPROVAL_HASH_MISMATCH`.

### Phase 4: Production Connection Verification
1. Verify exchange credentials in the secure secrets manager (API Key, Secret, Passphrase).
2. Confirm exchange API keys have **Futures Trading** permissions but **Withdrawal Permissions are strictly DISABLED**.
3. Set the live trading runtime environment variable:
   ```env
   LIVE_TRADING_ENABLED=true
   PROACTIVE_AI_STAGE=APPROVED_LIVE_CANARY
   MAX_LIVE_CANARY_PORTFOLIO_RISK_PCT=0.005
   ```
4. Perform pre-flight API ping to verify exchange connectivity and clock synchronization ($\Delta t < 500\text{ ms}$).

### Phase 5: Live Canary Monitoring & Scaling
1. Deploy the approved version into production canary mode.
2. Verify initial orders execute at probe size ($\le 0.5\%$ portfolio risk).
3. Monitor the first 20 live trades through the real-time Protection & Risk Compliance dashboard.
4. After 50 successful live trades with zero protection failures and positive net expectancy, operator review is required to scale from canary probe to full nominal sizing.

### Phase 6: Emergency Manual Intervention
In the event of anomalous behavior, market disruption, or exchange maintenance:
- **Emergency Halt (Kill Switch):**
  - Via CLI: `pnpm --filter @platform/api exec ts-node scripts/emergency-halt.ts --reason "Unscheduled exchange maintenance"`
  - Or via API: `POST /api/v1/live-trading/emergency-halt` with operator token.
- **Immediate Result:**
  - Cancels all open orders across all symbols.
  - Leaves protective stop-loss orders intact or places market stops on unprotected fills.
  - Reverts promotion state machine to `SHADOW`.
  - Disables new order intake until explicit operator resumption.

---

## 7. Adaptive Professional Entry Rollout Protocol & Telemetry

The Adaptive Professional Entry enhancement upgrades entry precision across ranging boundaries, intrabar transition probes, breakout retests, and pullback reclaims.

### 7.1. Rollout Stages & Promotion Progression

1. **Stage 1: Replay & Offline Backtest**
   - Replay historical candles (e.g. ZRO-USDT Sept 11–13 ranging dataset).
   - Validate that range reversion enters only at extremes (percentile $\le 30\%$ for long, $\ge 70\%$ for short).
   - Confirm late entries in the middle 40% of ranges are strictly rejected (`RANGE_SHORT_NOT_AT_UPPER_BOUNDARY` / `WAIT`).

2. **Stage 2: Counterfactual Shadow Mode**
   - Run live incoming quotes through shadow pipeline.
   - Record canonical setup telemetry and verify zero plan drift.
   - Accumulate $\ge 50$ completed counterfactual lifecycles.

3. **Stage 3: DEMO Canary**
   - Connect to Binance/OKX testnet.
   - Execute staged probe sizing (capped at $20\%$ nominal size factor) on intrabar transitions.
   - Enforce limit order preservation: approved LIMIT terms must execute as IOC limit orders, never mutated to market orders.

4. **Stage 4: Approved Live Canary**
   - Minimum 50 demo executions with positive expectancy.
   - Two-step operator signoff on frozen configuration hash.

### 7.2. Hard Stop Conditions (Immediate Demotion to Shadow)

The pipeline automatically halts and demotes to `SHADOW` upon any of the following triggers:

| Breach Condition | Threshold / Trigger | Action |
|---|---|---|
| **Plan Drift** | `planDriftCount > 0` (submitted order type or price deviates from approved plan) | Immediate Demotion & Circuit Breaker |
| **Chase Rate Inflation** | `chaseRate > 0.25` (signals exceeding ATR chase distance) | Immediate Reversion to Closed-Candle Only |
| **Negative Holdout Expectancy** | `postCostExpectancy <= 0.0 R` over rolling 30 trades | Freeze Live Order Routing |
| **Excessive Drawdown** | `maxDrawdownR > 5.0 R` or portfolio drawdown $> 10\%$ | Emergency Halt & Risk Review |

### 7.3. Telemetry Schema & Aggregated Metrics

Telemetry is recorded per stage execution via `PipelineAnalyticsService`:
- **Granular Fields:** `regime`, `setup`, `rangePercentile`, `triggerDistance`, `consumedMove`, `candleFinality`, `action`, `riskTier`, `judgeVerdict`, `quantReason`, `approvedOrderType`, `submittedOrderType`, `planDrift`, `lifecycleNetR`.
- **Aggregated Rollout Metrics:**
  - `rangeOpportunitiesCount`: Total opportunities identified in ranging regimes.
  - `rangeParticipationRate`: Ratio of executed range entries to total valid range setups.
  - `probeCount`: Number of reduced-risk ($20\%$ size factor) transition probes.
  - `chaseCount` & `chaseRate`: Signals rejected for exceeding ATR distance from trigger.
  - `planDriftCount`: Count of mismatches between approved and submitted order terms (must remain 0).
  - `postCostExpectancy`: Average lifecycle Net R net of all trading costs, fees, and slippage.
  - `profitFactor`: Ratio of gross gains to gross losses across closed lifecycle trades.
  - `maxDrawdownR`: Maximum peak-to-trough equity decline measured in R.

