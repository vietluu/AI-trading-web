# PROJECT RULES

## General Rules
- Always use TypeScript.
- Never use any.
- Never skip validation.
- Never skip logging.
- Never skip error handling.
- Never skip testing.
- Never generate fake implementations.

------------------------------------------------

## Architecture Rules
- Every feature must be isolated.
- Every module owns its domain.
- Use DTO.
- Use Services.
- Use Repository Pattern.
- Use Dependency Injection.
- No business logic inside Controllers.

------------------------------------------------

## Database Rules
- Use Prisma.
- Never write raw SQL unless necessary.
- Every migration must be reversible.

------------------------------------------------

## AI Rules
- AI cannot directly execute trades.
- Every AI output must be persisted.
- Track:
    - prompt
    - response
    - latency
    - token usage

------------------------------------------------

## Risk Rules
- Every order must pass Risk Engine.
- Risk Engine cannot be bypassed.
- Maximum leverage configurable.
- Maximum exposure configurable.
- Maximum daily loss configurable.

------------------------------------------------

## Trading Rules
- Paper Trading first.
- Live Trading disabled by default.
- Live Trading enabled only through ENV.

------------------------------------------------

## Quality Rules
- No TODO.
- No duplicated code.
- No dead code.
- Every API documented.
- Every module tested.
