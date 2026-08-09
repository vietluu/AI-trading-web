# Project context

## Vision

Build a production-oriented multi-agent cryptocurrency futures platform that
collects realtime data, produces explainable decisions, enforces deterministic
risk, evaluates outcomes, and can optionally execute through Binance Futures or
OKX Futures.

This is not a single-strategy bot:

- AI agents analyze and recommend.
- The Decision/Judge pipeline consolidates and validates signals.
- The Risk Engine approves/rejects and sizes trades.
- The Trading Engine is the only exchange mutation boundary.
- Performance, Reflection, Research, and Self-Learning evaluate changes before
  promotion.

## Current flow

```text
Market streams + indicators + external data
  → specialized agents
  → fusion / Decision Agent
  → Judge and deterministic signal filters
  → adaptive Trade Plan Engine (regime, entry, TP, SL, R:R)
  → Risk Engine and portfolio limits
  → DEMO/LIVE exchange execution
  → Position Manager (protect, amend, partial exit, time exit)
  → performance, reflection, research, shadow/canary learning
```

## Delivered domains

- Foundation, authentication, security, credentials, settings, and audit.
- Binance/OKX exchange integration and realtime market data.
- External news/social/macro ingestion and realtime notifications.
- AI provider abstraction, safe tool calling, specialized agents, and pipeline
  automation.
- Adaptive risk/trade planning and exchange-backed Live Trading.
- Portfolio management, performance/reflection, backtest/validation, quantitative
  intelligence, simulations, recommendations, and self-learning governance.
- Next.js dashboards for market, AI, risk, portfolio, live trading, research,
  recommendations, factors, knowledge, and system operations.

Paper/shadow data models are present and used by evaluation workflows, but a
standalone paper execution service/API remains incomplete.

## Safety principles

- Risk has precedence over opportunity.
- AI never receives exchange credentials and never invokes exchange mutations.
- Every automated order requires fresh deterministic approval.
- TP/SL adapts to market structure when sufficient data exists; environment
  percentages are fallback/policy limits, not the primary market model.
- Live production execution is disabled by default and requires explicit gates.
- Every user-owned query is scoped by the authenticated user and connection.
- Secrets are encrypted and excluded from responses and logs.

## Technology

- Web: Next.js, React, TypeScript, Tailwind CSS, TanStack Query, Socket.IO client,
  Lightweight Charts.
- API: NestJS, Prisma, PostgreSQL, Redis, BullMQ, Socket.IO, Zod/shared contracts.
- AI: provider-independent orchestration for OpenAI, Anthropic, Gemini, and
  Ollama configuration.
- Infrastructure: pnpm monorepo and Docker Compose.
