# PROJECT CONTEXT

## Vision
Build a production-ready AI Multi-Agent Cryptocurrency Futures Research Platform.
This project is NOT a simple trading bot.
The platform must collect realtime data, analyze market conditions using multiple AI Agents, simulate trades, evaluate performance, and optionally execute trades through Binance Futures or OKX Futures.
The system must always prioritize risk management over trading opportunities.

AI is an advisor.
Risk Engine is the decision maker.
Trading Engine is the executor.

------------------------------------------------

## Objectives
- Realtime Market Data
- AI Analysis
- Trading Signal Generation
- Paper Trading
- Backtesting
- Live Trading
- Dashboard
- Performance Analytics

------------------------------------------------

## High Level Flow
Market Data
↓
Indicators
↓
News
↓
Social
↓
On-chain
↓
AI Agents
↓
Decision Agent
↓
Judge Agent
↓
Risk Engine
↓
Paper Trading
↓
Live Trading (Disabled by default)

------------------------------------------------

## Tech Stack

### Frontend
- Next.js
- React
- TypeScript
- TailwindCSS
- shadcn/ui
- Zustand
- TanStack Query
- TradingView Lightweight Charts

### Backend
- NestJS
- Prisma
- PostgreSQL
- Redis
- BullMQ
- WebSocket

### Infrastructure
- Docker
- Docker Compose

### AI
- OpenAI Responses API
Architecture must allow replacing AI provider later.

------------------------------------------------

## Design Principles
- DDD
- SOLID
- Clean Architecture
- Feature Modules
- Dependency Injection
- Repository Pattern
- Typed APIs
- No duplicated code
- Production Ready

------------------------------------------------

## Project Goal
Every module must be independently testable.
The project must always remain runnable.
Never leave unfinished implementations.
Never break previous phases.

## Current delivery: Phase 3

The repository now includes the authenticated, multi-user exchange integration
boundary for Binance USD-M Futures and OKX perpetual swaps. Public REST market
queries and read-only private account queries are normalized behind a shared
adapter contract. Each private call resolves its connection from the current
server-side session and decrypts that user's credential immediately before use.

Phase 3 deliberately exposes no order placement, cancellation, leverage,
margin-mode, transfer, automation, agent, or WebSocket path. Production
connections are feature-flagged off by default. Realtime collection remains
owned by Phase 4.
