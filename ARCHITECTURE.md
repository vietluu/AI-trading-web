# System architecture

## Phase 3 platform

```text
Browser
  │
  ├── Next.js web application (localhost:3000)
  │     ├── account, credential, and exchange management pages
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
        ├── exchange module
        │     ├── normalized domain contract and provider factory
        │     ├── Binance USD-M and OKX swap REST adapters
        │     ├── signing, time synchronization, bounded retries
        │     ├── Redis public cache and scoped rate limits
        │     └── user-owned read-only account operations
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
- Public market cache entries are global; private account responses are never
  persisted or put into a shared cache.
- Every connection query includes both its ID and the session-derived user ID.
- Production connection creation/enabling is disabled by default and requires
  recent password authentication when enabled. Sensitive mutations also pass
  the Phase 2 TOTP guard.

## Exchange request sequence

```text
Frontend
   | authenticated request + CSRF token
   v
Exchange Controller
   | current user from server-side session
   v
Exchange Connection Service
   | ownership + enabled + verified checks
   v
Encrypted Credential
   | AES-GCM decrypt immediately before use
   v
Exchange Adapter Factory
   +------------------------+
   |                        |
   v                        v
Binance Futures Adapter   OKX Futures Adapter
   | signed REST             | signed REST
   v                         v
Binance USD-M API         OKX v5 API
```

Core code uses normalized `BASE-QUOTE` symbols, interval enums, ISO dates, and
decimal strings. Provider response DTOs remain inside infrastructure adapters.
Adding a provider requires a new `ExchangeAdapter`, provider/environment
validation, factory registration, and mapper contract tests; consumers do not
change.

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
execution must pass through the deterministic Risk Engine. Phase 3 has no
trading mutations and no realtime streaming or storage.
