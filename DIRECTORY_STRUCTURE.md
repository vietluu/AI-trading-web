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
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   ├── audit/
│   │   │   ├── auth/
│   │   │   ├── common/
│   │   │   ├── config/
│   │   │   ├── credentials/
│   │   │   ├── database/
│   │   │   ├── health/
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
│       │   │   ├── profile/
│       │   │   ├── register/
│       │   │   ├── reset-password/
│       │   │   ├── security/
│       │   │   └── settings/
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

Only modules owned by completed phases are present. Exchange integrations,
market collectors, AI agents, risk, and trading modules are added only by their
roadmap phases; empty future directories are not scaffolded.
