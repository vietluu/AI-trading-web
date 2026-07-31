# API contract

All REST routes use the `/api` prefix. Swagger is available at `/docs` and its
OpenAPI JSON document at `/docs/json`. Request DTOs are validated globally;
unknown properties are rejected.

Authenticated routes use the opaque `sid` HttpOnly cookie. The cookie is
SameSite=Lax, secure in production, and never read by frontend code.

## Health

- `GET /api/health` checks PostgreSQL and Redis.

## Authentication

- `POST /api/auth/register` creates a user and session.
- `POST /api/auth/login` creates a session after credential and lock checks.
- `POST /api/auth/logout` destroys the current session.
- `POST /api/auth/refresh` rotates the current session.
- `POST /api/auth/forgot-password` issues a generic accepted response.
- `POST /api/auth/reset-password` consumes a short-lived, single-use token.
- `POST /api/auth/change-password` changes the password, revokes all sessions,
  and creates a replacement session for the current device.
- `GET /api/auth/me` returns only public user fields.
- `GET /api/auth/sessions` lists active device sessions.
- `DELETE /api/auth/sessions/:id` revokes one user-owned session.
- `DELETE /api/auth/sessions` logs out all devices.

## Credentials

- `GET /api/credentials` returns user-owned provider metadata.
- `POST /api/credentials` encrypts and stores credential material.
- `PUT /api/credentials/:id` updates a user-owned credential.
- `DELETE /api/credentials/:id` removes a user-owned credential.
- `POST /api/credentials/:id/test` verifies stored ciphertext integrity.

Credential responses contain `provider`, `status`, `maskedKey`, and
`lastVerified` metadata; they never contain plaintext keys, secrets,
passphrases, or ciphertext.

## Settings

- `GET /api/settings` returns settings owned by the current user.
- `PUT /api/settings` validates and updates those settings.

## Error response

HTTP failures use the global shape below. Unexpected server exceptions return
a generic message and error name; detailed exceptions remain only in server
logs.

```json
{
  "statusCode": 401,
  "timestamp": "2026-07-31T09:10:00.000Z",
  "path": "/api/auth/me",
  "message": "Authentication required",
  "error": "UnauthorizedException"
}
```

## Reserved for later roadmap phases

Market, news, signal, analysis, paper-trading, live-trading, and performance
routes are not implemented in Phase 2.
