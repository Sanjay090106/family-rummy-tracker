# Family Rummy Score Tracker

A private family application for recording Rummy scores, tracking set winners, and viewing session rankings.

## Project structure

- `frontend/` — React, TypeScript, Vite, and Tailwind CSS
- `backend/` — Node.js, Express, and TypeScript
- `prisma/` — Prisma schema and database migrations
- `tests/` — Root-level test resources

## Prerequisites

- Node.js and npm
- PostgreSQL when database integration is configured

## Install dependencies

Run from the project root:

```bash
npm install
```

## Development

Start the frontend:

```bash
npm run dev:frontend
```

Start the backend in a separate terminal:

```bash
npm run dev:backend
```

## Verification

```bash
npm run typecheck
npm run build
npm run test
npm run lint
```

## Environment and security

Use local environment files for secrets. Never commit real database credentials, API keys, or authentication secrets.

Hosting provider selection is intentionally undecided.
