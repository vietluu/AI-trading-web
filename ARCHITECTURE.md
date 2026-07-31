# System architecture

## Phase 2 platform

```text
Browser
  │
  ├── Next.js web application (localhost:3000)
  │     ├── account and credential management pages
  │     ├── browser-managed HttpOnly session cookie
  │     └── runtime-validated responses from @platform/shared
  │
  └── NestJS REST API (localhost:3001)
        ├── global request validation, exception handling, and Swagger
        ├── authentication module
        │     ├── Argon2id passwords
        │     ├── registration, login, and password recovery
        │     └── login throttling and temporary account lockout
        ├── session module
        │     ├── opaque cookie token
        │     ├── HMAC-derived identifier in PostgreSQL
        │     └── active session value and TTL in Redis
        ├── credential module
        │     └── per-user AES-256-GCM encrypted secrets
        ├── settings and audit modules
        └── health module
              ├── Prisma ── PostgreSQL
              └── ioredis ── Redis (BullMQ-safe noeviction policy)
```

The pnpm workspace contains `apps/web`, `apps/api`, and `packages/shared`.
Feature modules use controllers, services, repositories, and dependency
injection. Every authenticated repository query is scoped to the current user.
There are no roles, organizations, teams, or tenant hierarchy.

## Security boundaries

- The browser cannot read the session cookie or stored credentials.
- Raw session and password-reset tokens are never persisted or logged.
- Credential ciphertext is bound to its user and provider with GCM additional
  authenticated data.
- The encryption master key is supplied only through the environment.
- Authentication responses exclude password hashes and session secrets.

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
execution must pass through the deterministic Risk Engine. Exchange, market,
agent, risk, and trading components are not implemented in Phase 2.
