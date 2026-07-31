# System architecture

## Phase 1 foundation

```text
Browser
  │
  ├── Next.js web application (localhost:3000)
  │     └── validates API responses with @platform/shared
  │
  └── NestJS REST API (localhost:3001)
        ├── configuration validation
        ├── global validation and exception handling
        ├── structured JSON logging
        ├── Swagger
        └── health module
              ├── Prisma ── PostgreSQL
              └── ioredis ── Redis (BullMQ-safe noeviction policy)
```

The pnpm workspace contains `apps/web`, `apps/api`, and `packages/shared`.
Shared Zod schemas provide runtime validation and inferred TypeScript contracts
at the frontend/backend boundary.

## Planned execution flow

```text
Data Sources
  → Specialized Agents
  → Decision Agent
  → Judge Agent
  → Deterministic Risk Engine
  → Paper Trading
  → Optional Live Trading (disabled by default)
```

AI remains advisory and cannot call an exchange execution path. Future order
execution must pass through the deterministic Risk Engine. Those domain
components are not implemented in Phase 1.
