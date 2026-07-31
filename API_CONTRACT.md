# API contract

All REST routes use the `/api` prefix. Swagger is available at `/docs` and its
OpenAPI JSON document at `/docs/json`.

## Active in Phase 1

### `GET /api/health`

Checks the API's PostgreSQL and Redis dependencies.

Successful response (`200`):

```json
{
  "status": "ok",
  "timestamp": "2026-07-31T09:09:58.403Z",
  "services": {
    "database": {
      "status": "up",
      "latencyMs": 5
    },
    "redis": {
      "status": "up",
      "latencyMs": 3
    }
  }
}
```

Dependency failure (`503`) and all other HTTP failures use the global error
shape:

```json
{
  "statusCode": 503,
  "timestamp": "2026-07-31T09:10:00.000Z",
  "path": "/api/health",
  "message": "One or more platform dependencies are unavailable",
  "error": "ServiceUnavailableException"
}
```

## Reserved for later roadmap phases

These contracts are architectural targets and are not implemented in Phase 1:

### GET

- `/api/market`
- `/api/news`
- `/api/signals`
- `/api/paper-trades`
- `/api/performance`

### POST

- `/api/analysis/run`
- `/api/paper-trading/start`
- `/api/paper-trading/stop`
- `/api/live-trading/start`
- `/api/live-trading/stop`
