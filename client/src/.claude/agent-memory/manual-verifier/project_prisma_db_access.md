---
name: project-prisma-db-access
description: How to access the SQLite database directly for throwaway scripts
metadata:
  type: project
---

The SQLite database file is at `./server/prisma/dev.db` relative to project root (matches DATABASE_URL in .env: `file:./server/prisma/dev.db`).

The Prisma-generated client is ESM-only (TypeScript source in `server/prisma/generated/client/`). For throwaway scripts, skip the Prisma client entirely and use `better-sqlite3` directly:

```js
const Database = require('better-sqlite3');
const db = new Database('./server/prisma/dev.db');
```

Key table name: `jobs_listing` (NOT `job_listings` — Prisma model is `job_listings` but the SQLite table is `jobs_listing`).

The server's singleton Prisma client is at `server/src/prismaClient.ts` — it uses `@prisma/adapter-better-sqlite3`.

**Why:** The generated client is .ts (ESM) and requires `import.meta.url` which doesn't work with tsx in commonjs mode. better-sqlite3 is already a dependency and works with plain node/require.
