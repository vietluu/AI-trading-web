# Directory structure

```text
.
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── migrations/          # committed schema history through Position Manager
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   ├── auth/                # identity, password, TOTP, recent auth
│   │   │   ├── session/             # cookie/session lifecycle
│   │   │   ├── credentials/         # encrypted provider credentials
│   │   │   ├── exchange/            # normalized Binance/OKX adapters and connections
│   │   │   ├── market-data/         # streams, indicators, persistence, gaps/backfill
│   │   │   ├── modules/
│   │   │   │   ├── external-data/   # news, social, sentiment, macro ingestion
│   │   │   │   ├── ai/              # providers, config, usage, memory/history
│   │   │   │   ├── ai-tools/        # safe tool registry/policy/execution
│   │   │   │   ├── agents/          # specialized agents and lifecycle
│   │   │   │   ├── pipeline/        # Decision/Judge orchestration and scheduling
│   │   │   │   ├── risk/            # risk engine and adaptive Trade Plan
│   │   │   │   ├── live-trading/    # execution, sync, gateway, Position Manager
│   │   │   │   ├── portfolio/       # allocation, exposure, rebalance
│   │   │   │   ├── reflection/      # performance and self-learning governance
│   │   │   │   └── research/        # backtest, validation, quant intelligence
│   │   │   ├── audit/
│   │   │   ├── database/
│   │   │   ├── health/
│   │   │   ├── redis/
│   │   │   └── settings/
│   │   └── test/                     # unit, contract, integration and e2e suites
│   └── web/
│       └── src/
│           ├── app/
│           │   ├── ai/               # agents, decisions, pipeline, risk, portfolio, performance
│           │   ├── live-trading/
│           │   ├── market/
│           │   ├── news/ macro/ sentiment/
│           │   ├── research/ strategy-lab/ factors/
│           │   ├── quant-intelligence/ portfolio-intelligence/
│           │   ├── recommendations/ knowledge/
│           │   ├── settings/ system/
│           │   └── account/authentication pages
│           ├── components/
│           ├── hooks/
│           ├── lib/
│           └── services/
├── packages/
│   └── shared/                        # shared Zod schemas and TypeScript contracts
├── .env.example                       # authoritative safe runtime configuration example
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── *.md                               # architecture, API, database, roadmap and rules
```

Feature code belongs in the owning module. Provider-specific request schemas,
signing, and mappings stay under exchange infrastructure; adaptive risk and
Position Manager rules remain deterministic domain code and are covered by
focused tests.
