# Database

PostgreSQL is the durable store and Prisma owns the schema/migration history.
Redis is used for active sessions, throttles, cache, cancellation flags, leader
leases, quotas, and BullMQ; it is not the long-term source of truth.

## Model groups

### Identity and security

- `User`, `Session`, `EncryptedCredential`, `ExchangeConnection`, `UserSetting`,
  and `AuditLog`.
- Session/CSRF raw tokens and plaintext credentials are never stored.
- Exchange connections store safe provider/environment, verification,
  permission, enablement, and normalized error metadata.

### Market and external data

- `MarketInstrument`, `MarketCandle`, `FundingRateSnapshot`,
  `OpenInterestSnapshot`, `MarketDataGap`, `MarketStreamIncident`, and
  `IndicatorSnapshotRecord`.
- `ExternalDataSource`, `NewsDuplicateGroup`, `NewsArticle`, source references,
  article symbols/topics/entities, `ExchangeAnnouncement`, `SecurityIncident`,
  `MarketSentimentObservation`, `SocialPost`, `MacroEconomicEvent`, import/run
  records, provider health, preferences, and user news state.

### AI and agent runtime

- `AIHistory`, `AIMemory`, `AIConfiguration`, and `AIUsage`.
- `ToolInvocationRecord`, `ToolDefinitionMetadata`, and `ToolQuotaUsage`.
- Agent definitions/runs/transitions/context snapshots/outputs/quota usage.
- Pipeline schedules/runs/step runs/alerts with replay, status, decision,
  confidence, stored context, and timing metadata.

### Trading, risk, and portfolio

- Paper/shadow foundation: `PaperAccount`, `PaperPosition`, `SimulatedOrder`,
  `PaperTrade`, and `PaperSignal`.
- `RiskAssessment` persists account/connection scope, decision, entry, size,
  leverage, TP/SL, approval/rejection, limits snapshot, and expiry.
- `LiveOrder`, `LivePosition`, and `LiveAccountSnapshot` persist normalized
  exchange-backed state.
- Portfolio strategy, allocation, performance, position, trade result, risk
  event, and rebalance models.

`LiveOrder` additionally stores Position Manager state:

- `initialStopLoss`, current `stopLoss`, and `takeProfit`;
- `highestMark` and `lowestMark`;
- protective client order ID;
- serialized adaptive `tradePlan`;
- `partialTakenAt`.

Recent-history retrieval is capped at 20 in Live Trading application queries;
historical database rows are retained and analytics queries are not truncated
by that UI rule.

### Evaluation, research, and learning

- `PerformanceRecord`, `ReflectionInsight`, and `ImprovementProposal`.
- Research validation, benchmark, sensitivity, hypothesis, discovered strategy,
  factor evaluation, auto-benchmark, weight/threshold optimization, regime,
  recommendation, simulation, report, and knowledge archive records.
- `SelfLearningConfiguration`, `SelfLearningExperiment`, and experiment events
  support shadow/canary/rejection/promotion governance.

## Migration history

Committed migrations cover foundation/authentication, exchange connections,
market data, external ingestion, AI/tools/agents, pipeline, reflection,
paper-trading schema, risk, live trading, portfolio, connection-scoped risk,
self-learning, runtime indexes/statistics/governance, and Position Manager state.

The latest Position Manager migration is:

```text
20260808213000_add_position_manager_state
```

Apply migrations through:

```bash
pnpm db:generate
pnpm db:migrate
```

Do not edit an already-applied migration. Add a new forward migration and a
reviewed recovery/rollback procedure for material schema changes.
