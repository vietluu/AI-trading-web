# AI Trading Agents

> **Production-ready AI-powered cryptocurrency futures trading research platform**

[![CI](https://github.com/vietluu/AI-trading-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/vietluu/AI-trading-agents/actions/workflows/ci.yml)
[![Python 3.11](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-green.svg)](https://fastapi.tiangolo.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Overview

AI Trading Agents is a modular, production-grade research platform for algorithmic cryptocurrency futures trading. It integrates real-time market data, AI-powered analysis, and structured risk management into a single, extensible system.

### Core Capabilities

| Capability | Description |
|---|---|
| 📊 **Market Data** | Real-time OHLCV, tickers, and order book via OKX WebSocket & REST |
| 📰 **News Intelligence** | CryptoPanic integration for market-moving news aggregation |
| 🧠 **AI Analysis** | GPT-4o market analysis combining technical, fundamental & on-chain signals |
| 🔬 **Technical Analysis** | 20+ indicators: RSI, MACD, Bollinger Bands, EMA, ATR, ADX, etc. |
| 📡 **On-Chain Metrics** | Glassnode integration: active addresses, NVT, MVRV, SOPR, exchange netflow |
| 🎯 **Signal Generation** | Rule-based and AI-powered trading signal generation |
| 🛡️ **Risk Management** | Kelly Criterion sizing, drawdown limits, position concentration controls |
| 📝 **Paper Trading** | Full simulation engine with stop-loss/take-profit execution |
| 📈 **Backtesting** | Historical strategy evaluation with Sharpe ratio, max drawdown, win rate |
| 🔄 **Task Scheduling** | Celery-based background workers for continuous data collection |

---

## Architecture

The platform follows **Clean Architecture** + **Domain-Driven Design** + **Feature-based** organization:

```
src/
├── core/                          # Domain layer (no external dependencies)
│   ├── domain/
│   │   ├── entities/              # OHLCV, Order, Position, Signal, NewsArticle, etc.
│   │   ├── value_objects/         # Enums: Timeframe, OrderSide, SignalDirection, etc.
│   │   └── repositories/          # Abstract repository interfaces (ports)
│   ├── use_cases/                 # Application use cases
│   ├── interfaces/                # External service interfaces
│   └── config.py                  # Pydantic Settings configuration
│
├── features/                      # Feature modules (vertical slices)
│   ├── market_data/               # Market data collection
│   ├── news/                      # News aggregation
│   ├── sentiment/                 # Sentiment analysis
│   ├── onchain/                   # On-chain metrics
│   ├── ai_analysis/               # AI market analysis + technical indicators
│   ├── signals/                   # Signal generation
│   ├── risk_management/           # Risk assessment and position sizing
│   ├── paper_trading/             # Paper trading simulation engine
│   └── backtesting/               # Historical strategy backtesting
│
├── infrastructure/                # Infrastructure layer (adapters)
│   ├── database/                  # SQLAlchemy async ORM models
│   ├── cache/                     # Redis client
│   ├── messaging/                 # Celery tasks and scheduler
│   └── external_apis/
│       ├── okx/                   # OKX REST + WebSocket clients
│       ├── news/                  # CryptoPanic client
│       └── onchain/               # Glassnode client
│
└── api/                           # API layer (FastAPI)
    ├── v1/routes/                 # REST endpoints
    └── middleware/                # Logging, CORS, auth
```

### Design Principles

- **Clean Architecture**: Domain entities have zero external dependencies
- **Domain-Driven Design**: Bounded contexts per feature with explicit domain language
- **SOLID**: Single responsibility, dependency inversion via abstract repositories
- **Feature-based**: Each feature is self-contained with its own models, collectors, and tests
- **Typed**: 100% type annotations throughout (`mypy` compatible)
- **Async-first**: All I/O operations use `asyncio` / `httpx` / `asyncpg`

---

## Quick Start

### Prerequisites

- Python 3.11+
- PostgreSQL 16+
- Redis 7+
- Docker & Docker Compose (recommended)

### Option 1: Docker Compose (Recommended)

```bash
# Clone and configure
git clone https://github.com/vietluu/AI-trading-agents.git
cd AI-trading-agents
cp .env.example .env

# Edit .env with your API keys
nano .env

# Start all services
make docker-up

# API available at http://localhost:8000
# Docs at http://localhost:8000/api/docs
```

### Option 2: Local Development

```bash
# Install dependencies
make install-dev

# Start PostgreSQL and Redis (or use Docker)
docker run -d -p 5432:5432 -e POSTGRES_DB=trading_db \
  -e POSTGRES_USER=trading_user -e POSTGRES_PASSWORD=trading_password \
  postgres:16-alpine

docker run -d -p 6379:6379 redis:7-alpine

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Run the API
make run-dev
```

---

## Configuration

All configuration is managed via environment variables (see `.env.example`):

### Required API Keys

| Variable | Description | Get It |
|---|---|---|
| `OKX_API_KEY` | OKX exchange API key | [OKX API Docs](https://www.okx.com/docs-v5/en/) |
| `OKX_API_SECRET` | OKX API secret | |
| `OKX_PASSPHRASE` | OKX API passphrase | |
| `OPENAI_API_KEY` | OpenAI GPT-4o key (for AI analysis) | [OpenAI Platform](https://platform.openai.com/) |
| `CRYPTOPANIC_API_KEY` | CryptoPanic news API | [CryptoPanic Developers](https://cryptopanic.com/developers/api/) |
| `GLASSNODE_API_KEY` | Glassnode on-chain metrics | [Glassnode Studio](https://studio.glassnode.com/) |

### Key Trading Parameters

```env
OKX_SANDBOX=true                    # Use sandbox (set false for live trading)
DEFAULT_LEVERAGE=1                  # Default futures leverage (1-125)
MAX_POSITION_SIZE_PCT=0.05          # Max 5% of portfolio per trade
RISK_PER_TRADE_PCT=0.02             # Risk 2% per trade
MAX_DRAWDOWN_PCT=0.15               # Halt trading at 15% drawdown
PAPER_TRADING_INITIAL_BALANCE=100000.0
```

---

## API Reference

Interactive API docs available at `http://localhost:8000/api/docs`

### Key Endpoints

#### Market Data
```http
GET /api/v1/market/candles/{symbol}?timeframe=4h&limit=100
GET /api/v1/market/ticker/{symbol}
```

#### Trading Signals
```http
POST /api/v1/signals/generate/{symbol}?timeframe=4h&use_ai=false
```

#### Paper Trading
```http
GET  /api/v1/paper-trading/portfolio
POST /api/v1/paper-trading/execute
GET  /api/v1/paper-trading/positions
DELETE /api/v1/paper-trading/positions/{position_id}
```

#### Backtesting
```http
POST /api/v1/backtesting/run
{
  "symbol": "BTC-USDT-SWAP",
  "timeframe": "4h",
  "bars": 300,
  "initial_capital": 10000,
  "stop_loss_pct": 0.02,
  "take_profit_pct": 0.04,
  "leverage": 1
}
```

#### Health
```http
GET /api/v1/health
GET /api/v1/ready
GET /metrics          # Prometheus metrics
```

---

## Development

```bash
# Run tests
make test

# Run tests with coverage
make test-cov

# Lint
make lint

# Auto-fix lint issues
make lint-fix

# Type check
make typecheck
```

### Testing Strategy

- **Unit tests** (`tests/unit/`): Domain entities, risk manager, paper trading, backtesting, technical analyzer — no external dependencies
- **Integration tests** (`tests/integration/`): Database and cache operations

---

## Background Tasks (Celery)

The platform runs scheduled background tasks via Celery:

| Task | Schedule | Description |
|---|---|---|
| `collect_market_data` | Every 60s | Fetch OHLCV for tracked symbols |
| `collect_news` | Every 5min | Fetch latest crypto news |
| `generate_signals` | Every hour | Generate technical signals |
| `update_paper_positions` | Every 30s | Check stop-loss/take-profit for paper positions |

Start workers:
```bash
# Worker (process tasks)
celery -A src.infrastructure.messaging.celery_app:celery_app worker --loglevel=info

# Beat (schedule tasks)
celery -A src.infrastructure.messaging.celery_app:celery_app beat --loglevel=info
```

---

## Signal Generation Pipeline

```
Market Data (OKX) ──┐
News (CryptoPanic) ──┤──► AI Analysis (GPT-4o) ──► TradingSignal
On-Chain (Glassnode) ┤         ▲
Technical Indicators ┘         │
                           Technical
                           Analyzer
                               │
                               ▼
                        Risk Assessment
                        (Kelly Criterion)
                               │
                               ▼
                        Paper Trade / Live Order
```

---

## Risk Management

The `RiskManager` enforces multiple safety layers:

1. **Confidence threshold**: Minimum 55% signal confidence required
2. **Risk-reward ratio**: Minimum 1.5:1 required
3. **Position size**: Fixed fractional risk (2% of portfolio per trade)
4. **Maximum position**: Capped at 5% of portfolio notional
5. **Drawdown halt**: Trading paused at 15% portfolio drawdown
6. **Kelly sizing**: Half-Kelly criterion for optimal bet sizing

---

## Production Deployment

For production deployment:

1. Set `APP_ENV=production` and `OKX_SANDBOX=false`
2. Use proper PostgreSQL and Redis instances (managed services recommended)
3. Set a strong `APP_SECRET_KEY`
4. Configure proper CORS origins
5. Use Alembic for database migrations: `alembic upgrade head`
6. Deploy behind a reverse proxy (nginx/traefik)
7. Set up monitoring via the `/metrics` Prometheus endpoint

---

## License

MIT License — see [LICENSE](LICENSE) for details.
