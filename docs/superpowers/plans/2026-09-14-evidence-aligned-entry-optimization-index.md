# Evidence-Aligned Entry Optimization Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement these plans in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved entry-optimization design through five independently reviewable, shadow-safe releases.

**Architecture:** Each phase has a separate plan, feature boundary, verification gate, and commit history. A later phase may consume persisted contracts from an earlier phase but may not weaken its safety constraints.

**Tech Stack:** NestJS, TypeScript, Prisma/PostgreSQL, BullMQ/Redis, Vitest, Next.js

**Spec:** `docs/superpowers/specs/2026-09-14-evidence-aligned-entry-optimization-design.md`

## Global Constraints

- Implement in the listed order; do not combine phase commits.
- New entry behavior remains shadow-only.
- Do not enable a production exchange connection or real-capital execution.
- DEMO probe execution requires a separate user approval after shadow evidence review.
- Use closed primary candles for recovery confirmation.
- Run migration dry-run diagnostics before adding uniqueness constraints.
- Preserve all existing account, Risk, protection, cooldown, and kill-switch gates.

## Ordered Plans

1. `2026-09-14-phase-1-gate-provenance-deduplication.md`
2. `2026-09-14-phase-2-exact-quant-cohorts.md`
3. `2026-09-14-phase-3-recovery-reclaim-state-machine.md`
4. `2026-09-14-phase-4-governed-shadow-probes.md`
5. `2026-09-14-phase-5-pnl-evaluation-promotion.md`

## Release Checkpoints

- Phase 1: blocker audit reconciles and duplicate samples stop increasing.
- Phase 2: no mismatched timeframe/policy can authorize execution.
- Phase 3: recovery decisions reproduce from closed candles without future data.
- Phase 4: shadow plans use execution-equivalent terms and never call exchange APIs.
- Phase 5: control/candidate reports reconcile post-cost PnL and enforce promotion eligibility.

