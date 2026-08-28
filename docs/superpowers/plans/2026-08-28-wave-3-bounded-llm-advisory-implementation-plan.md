# Wave 3 Bounded LLM Advisory Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure that all LLM interactions remain strictly advisory, deterministic, budget-capped ($10/day, $100/mo), and isolated from exchange mutations, with safe fallback to deterministic rules when LLM calls fail or budget is exhausted.

**Tech Stack:** NestJS, TypeScript, Prisma/PostgreSQL, Zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-28-platform-stabilization-design.md`

---

## Planned Commit Series

1. **Task 1 & 2:** Advisory Schema & Spend Cap Enforcement
   - `test(ai): specify advisory schema and budget enforcement`
   - `feat(ai): enforce daily monthly spend caps and cached advisory calls`
2. **Task 3 & 4:** Synthetic Tool Isolation
   - `test(ai): specify synthetic tool isolation`
   - `feat(ai): prohibit exchange and credential mutations from tool execution`
3. **Task 5 & 6:** Deterministic Fallback Under Advisory Failure
   - `test(ai): specify deterministic fallback under advisory failure`
   - `feat(ai): bypass advisory safely when circuit breaker opens`
4. **Task 7 & 8:** Model Policy Changes & Version Bumps
   - `test(ai): specify user-approved model policy changes`
   - `feat(ai): require version bump on prompt or provider change`
5. **Task 9:** Full Wave 3 Verification and Closure
   - `docs: close wave 3 bounded llm advisory rollout`
