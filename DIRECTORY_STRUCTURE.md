# Directory structure

```text
.
├── .github/
│   └── workflows/
│       └── ci.yml
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── migrations/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   ├── common/
│   │   │   ├── config/
│   │   │   ├── database/
│   │   │   ├── health/
│   │   │   ├── redis/
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── test/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   └── lib/
│       └── test/
├── packages/
│   └── shared/
│       ├── src/
│       │   └── schemas/
│       └── test/
├── .env.example
├── docker-compose.yml
├── eslint.config.mjs
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

Only Phase 1 directories exist. Domain modules and specialized agent packages
will be added by the roadmap phase that implements and owns them; empty future
directories are not scaffolded.
