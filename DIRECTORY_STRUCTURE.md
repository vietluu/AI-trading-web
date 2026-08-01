# Directory structure

```text
.
├── .github/workflows/ci.yml
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── migrations/
│   │   │   │   ├── 20260731000000_foundation/
│   │   │   │   └── 20260731010000_authentication/
│   │   │   │   ├── 20260731020000_auth_hardening/
│   │   │   │   └── 20260731030000_add_exchange_connections/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   ├── audit/
│   │   │   ├── auth/
│   │   │   ├── common/
│   │   │   ├── config/
│   │   │   ├── credentials/
│   │   │   ├── database/
│   │   │   ├── health/
│   │   │   ├── exchange/
│   │   │   │   ├── application/
│   │   │   │   ├── domain/
│   │   │   │   ├── infrastructure/binance/
│   │   │   │   ├── infrastructure/okx/
│   │   │   │   └── presentation/
│   │   │   ├── external-data/
│   │   │   │   ├── application/
│   │   │   │   ├── domain/
│   │   │   │   ├── infrastructure/
│   │   │   │   └── presentation/
│   │   │   ├── redis/
│   │   │   ├── session/
│   │   │   └── settings/
│   │   └── test/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   │   ├── api-keys/
│       │   │   ├── forgot-password/
│       │   │   ├── login/
│       │   │   ├── macro/
│       │   │   ├── news/
│       │   │   ├── profile/
│       │   │   ├── register/
│       │   │   ├── reset-password/
│       │   │   ├── security/
│       │   │   ├── sentiment/
│       │   │   ├── settings/
│       │   │   │   ├── data-sources/
│       │   │   │   └── exchanges/
│       │   │   └── system/
│       │   │       └── providers/
│       │   ├── components/
│       │   └── lib/
│       └── test/
├── packages/
│   └── shared/
│       ├── src/schemas/
│       └── test/
├── .env.example
├── docker-compose.yml
├── eslint.config.mjs
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

Only modules owned by completed phases are present. Market collectors, AI
agents, risk, and trading modules remain absent until their roadmap phases.
