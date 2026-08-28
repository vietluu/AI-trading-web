# Wave 4 Memory, Reflection, and Reporting Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement structured episode retention, deterministic hypothesis outcome & accuracy drift tracking, and automated scheduled quant reporting (daily & weekly performance attribution).

**Tech Stack:** NestJS, TypeScript, Prisma/PostgreSQL, Zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-28-platform-stabilization-design.md`

---

## Planned Commit Series

1. **Task 1 & 2:** Structured Episode Retention
   - `test(reflection): specify bounded episode and pattern retention`
   - `feat(reflection): persist structured execution episodes`
2. **Task 3 & 4:** Hypothesis Outcomes & Accuracy Drift
   - `test(memory): specify deterministic reflection calibration loop`
   - `feat(memory): record hypothesis outcomes and accuracy drift`
3. **Task 5 & 6:** Scheduled Quant Performance Attribution Reports
   - `test(reporting): specify daily weekly automated quant reports`
   - `feat(reporting): generate scheduled performance attribution reports`
4. **Task 7:** Full Wave 4 Verification and Closure
   - `docs: close wave 4 memory reflection and reporting rollout`
