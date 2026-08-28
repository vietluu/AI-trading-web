# Wave 5 Quant Lifecycle and Data Hygiene Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement reproducible hypothesis identity fingerprinting, bucketed regime persistence, normalized 0-100 probability scaling, provenance-backed factor & benchmark artifacts, and retention indexes.

**Tech Stack:** NestJS, TypeScript, Prisma/PostgreSQL, Zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-28-platform-stabilization-design.md`

---

## Planned Commit Series

1. **Task 1 & 2:** Hypothesis and Regime Identities
   - `test(quant): specify hypothesis and regime identities`
   - `fix(quant): upsert hypotheses and bucket regimes`
2. **Task 3 & 4:** Probability Metric Range Normalization (0-100)
   - `test(quant): validate probability units and ranges`
   - `fix(quant): normalize probability metrics`
3. **Task 5 & 6:** Provenance-backed Research Artifacts
   - `test(quant): require provenance for research artifacts`
   - `feat(quant): persist factor and benchmark artifacts`
4. **Task 7:** Full Wave 5 Verification and Closure
   - `docs: close wave 5 quant lifecycle and data hygiene rollout`
