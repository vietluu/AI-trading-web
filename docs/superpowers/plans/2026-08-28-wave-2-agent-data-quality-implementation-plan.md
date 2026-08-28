# Wave 2 Agent Data Quality and Registration Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that every specialist agent (Market, Technical, News, Sentiment, Macro, OnChain) produces verifiable, trustworthy data quality provenance (source timestamp, observation age, coverage, and explicit data quality reasons), unsupported or missing external data fails closed (neutral missing evidence marked INSUFFICIENT), decision synthesis dynamically down-weights PARTIAL data and eliminates INSUFFICIENT data contribution, and code-defined agent definitions are persisted idempotently on startup.

**Architecture:** 
1. **Provenance & Source Coverage:** Standardize specialist agent output contracts with structured provenance (`provider`, `sourceTimestamp`, `observationAgeMs`, `coverage`, `unavailableFields`, `dataQualityReason`).
2. **On-Chain Fallback & Unsupported Assets:** When an asset lacks verified on-chain metrics on CoinMetrics, degrade gracefully to free/public fallbacks or return neutral zero-bias evidence with `dataQuality: 'INSUFFICIENT'`; never synthesize fictional bullish/bearish flows.
3. **Sentiment & Social Source Normalization:** Explicitly record contributing sources (Alternative.me Fear & Greed, Reddit) and observation age. Mark stale/empty social sources appropriately without faking sentiment.
4. **Data-Quality Contribution Policy:** Update `DecisionService` and `DecisionJudgeService` so `QUALITY_FACTOR` for `INSUFFICIENT` is 0 (zero weight, zero directional influence) and `PARTIAL` is reduced (0.5), requiring `REQUEST_MORE_DATA` when core technical evidence or quorum is unsatisfied.
5. **Idempotent Agent Registration Sync:** On application bootstrap, synchronize code-defined `AgentDefinition` records to the database idempotently, computing stable schema and prompt hashes.

**Tech Stack:** NestJS, TypeScript, Prisma/PostgreSQL, Zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-28-platform-stabilization-design.md`

---

## Planned Commit Series

1. **Task 1 & 2:** Standardize Agent Provenance and Source Coverage
   - `test(agents): specify shared provenance and freshness contract`
   - `feat(agents): add source coverage to specialist outputs`
2. **Task 3 & 4:** On-Chain Verified Fallback and Unsupported Asset Handling
   - `test(onchain): specify free-provider fallback and unsupported assets`
   - `fix(onchain): implement verified coverage fallback`
3. **Task 5 & 6:** Sentiment and Social Source Normalization
   - `test(sentiment): specify source-level social coverage`
   - `fix(sentiment): normalize free social source health`
4. **Task 7 & 8:** Data-Quality Driven Decision Weighting and Judge Quorum
   - `test(decision): down-weight incomplete analysts`
   - `fix(decision): enforce data-quality contribution policy`
5. **Task 9 & 10:** Idempotent Startup Agent Definition Synchronization
   - `test(agents): persist definitions idempotently`
   - `fix(agents): synchronize runtime agent registrations`
6. **Task 11:** Full Wave 2 Verification and Closure
   - `docs: close wave 2 agent data quality rollout`
