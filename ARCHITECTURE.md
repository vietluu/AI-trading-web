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

## Phase 5 external data ingestion platform

```mermaid
graph TD
    subgraph External Sources
        RSS[Public RSS & Atom Feeds]
        BINANCE_ANN[Binance Announcements]
        OKX_ANN[OKX Announcements]
        FEAR_GREED[Alternative.me Fear & Greed]
        REDDIT[Reddit JSON / OAuth]
        MACRO_CSV[Manual Macro CSV / JSON Import]
    end

    subgraph Security & Network Filter
        SSRF[ExternalHttpClient - Timeout 10s / Size 5MB / SSRF IP Blocking]
        XXE[XMLParser - xxE Entity Resolution Disabled]
    end

    subgraph Ingestion Pipeline
        CANON[UrlCanonicalizer & Title Normalizer]
        DEDUP[Deduplication Engine - Jaccard & Cosine TF-IDF]
        META[Metadata Extractor - Symbol / Topic / Entity]
        SCORE[Deterministic Importance Scorer - 0-100 Score]
    end

    subgraph Queue & Storage
        BULL[BullMQ External Data Queue & Schedulers]
        PG[(PostgreSQL Shared Global & User State)]
        REDIS[(Redis Health Metrics & Cache)]
    end

    subgraph Realtime & Client
        GATEWAY[ExternalDataGateway - Socket.IO /external-data]
        FRONTEND[Next.js Web - /news, /macro, /sentiment, /settings/data-sources, /system/providers]
    end

    RSS --> SSRF
    BINANCE_ANN --> SSRF
    OKX_ANN --> SSRF
    FEAR_GREED --> SSRF
    REDDIT --> SSRF
    MACRO_CSV --> Ingestion Pipeline

    SSRF --> XXE --> Ingestion Pipeline
    BULL --> Ingestion Pipeline

    CANON --> DEDUP --> META --> SCORE --> PG
    SCORE --> GATEWAY --> FRONTEND
    Ingestion Pipeline --> REDIS
```

The pnpm workspace contains `apps/web`, `apps/api`, and `packages/shared`.
Feature modules use controllers, services, repositories, and dependency
injection. Every authenticated repository query is scoped to the current user.
There are no roles, organizations, teams, or tenant hierarchy. Global external
data (news, sentiment, macro) is shared, while user-specific bookmarks, read states,
and watchlist preferences are isolated per user.

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

---

## Phase 6.2 AI Tool Calling Framework Architecture

### 1. Provider-Independent Tool Call Flow

```mermaid
sequenceDiagram
    autonumber
    participant AI as AI Model / Provider
    participant Mapper as Provider Tool Call Mapper
    participant Registry as Tool Registry
    participant Policy as Tool Policy Engine
    participant Executor as Tool Executor Service
    participant Sanitizer as Result Sanitizer
    participant App as Application Service

    AI->>Mapper: Raw Provider Function/Tool Call
    Mapper->>Registry: Resolve Tool Definition by Canonical Name
    Registry-->>Mapper: ToolDefinition (Zod Input/Output, Metadata)
    Mapper->>Policy: Evaluate Execution Context & Policy
    Policy-->>Mapper: ToolPolicyDecision (ALLOW / DENY)
    alt Policy DENY
        Mapper-->>AI: Normalized Structured Denial Response
    else Policy ALLOW
        Mapper->>Executor: Execute Tool (Arguments, Server-Derived Context)
        Executor->>App: Invoke Application Service
        App-->>Executor: Raw Output
        Executor->>Sanitizer: Redact Secrets & Check Payload Bounds
        Sanitizer-->>Executor: Sanitized Output Payload
        Executor-->>Mapper: ToolResult (InvocationRecord persisted)
        Mapper-->>AI: Provider-Specific Tool Result Format
    end
```

### 2. Tool Policy Evaluation Flow

```mermaid
graph TD
    START[Tool Invocation Requested] --> CHK_STATUS{Tool Status ACTIVE?}
    CHK_STATUS -- No --> DENY_STATUS[DENY: Tool Disabled/Deprecated]
    CHK_STATUS -- Yes --> CHK_AUTH{Auth & User Context Present?}
    CHK_AUTH -- No --> DENY_AUTH[DENY: Authentication Required]
    CHK_AUTH -- Yes --> CHK_SIDE{Side Effect Write?}
    CHK_SIDE -- Yes --> DENY_SIDE[DENY: Write Operations Prohibited in Phase 6.2]
    CHK_SIDE -- No --> CHK_CAP{Required Capabilities in Context?}
    CHK_CAP -- No --> DENY_CAP[DENY: Missing Required Capability]
    CHK_CAP -- Yes --> CHK_QUOTA{User Rate Limit & Quota OK?}
    CHK_QUOTA -- No --> DENY_QUOTA[DENY: Rate Limit / Quota Exceeded]
    CHK_QUOTA -- Yes --> ALLOW[ALLOW Execution]
```

### 3. Multi-Round Model and Tool Execution Loop

```mermaid
graph LR
    SUBMIT[User Prompt] --> AI_REQ[Send Prompt & Canonical Tool Schemas]
    AI_REQ --> AI_RESP[Receive Provider Model Response]
    AI_RESP --> HAS_TOOLS{Model Requests Tool Call?}
    HAS_TOOLS -- No --> FINAL[Return Final AI Response]
    HAS_TOOLS -- Yes --> GUARD{LoopGuard Check Round & Recursion}
    GUARD -- Stop --> STOP_LOOP[Stop Execution: Loop Limit Exceeded]
    GUARD -- Allow --> EXEC[Execute Tools Parallel / Sequential]
    EXEC --> SANITIZE[Sanitize & Persist Invocation Record]
    SANITIZE --> NEXT_ROUND[Append Tool Results to Conversation]
    NEXT_ROUND --> AI_REQ
```

### 4. User-Private Exchange Tool Flow

```mermaid
sequenceDiagram
    autonumber
    participant AI as AI Model
    participant Framework as Tool Calling Framework
    participant Policy as Tool Policy Engine
    participant ConnService as Exchange Connection Service
    participant DB as PostgreSQL Database

    AI->>Framework: Invoke exchange.account.balances (connectionId)
    Framework->>Policy: Verify READ_USER_EXCHANGE_ACCOUNT capability
    Policy-->>Framework: ALLOW
    Framework->>ConnService: getConnectionForUser(userId, connectionId)
    ConnService->>DB: Query Connection WHERE id = connectionId AND userId = userId
    alt Connection Not Found / Not Owned
        DB-->>ConnService: Null
        ConnService-->>Framework: Throw Authorization Exception
        Framework-->>AI: Tool Error: Connection Not Found or Access Denied
    else Connection Owned by User
        DB-->>ConnService: Connection Details
        ConnService-->>Framework: Return Scoped Account Balances
        Framework-->>AI: Return Sanitized Balances (Credentials Never Exposed)
    end
```

### 5. Tool Timeout and Cancellation Flow

```mermaid
graph TD
    EXEC_START[Tool Execution Started] --> RACE{Promise.race}
    RACE --> HANDLER[Tool Handler Execution]
    RACE --> TIMER[Timeout Timer: e.g. 10000ms]
    RACE --> ABORT[AbortSignal Cancellation]

    HANDLER --> SUCCESS[Return Tool Result & Persist Record]
    TIMER --> TIMEOUT_ERR[TOOL_TIMEOUT Error & Telemetry Recorded]
    ABORT --> CANCEL_ERR[TOOL_CANCELLED Error & Telemetry Recorded]
```

