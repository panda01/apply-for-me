---
name: project-ports-health
description: Dev server ports and health check pattern for apply-for-me
metadata:
  type: project
---

Server runs on port 4000, Vite client on port 4173 (set in root .env as SERVER_PORT and CLIENT_PORT).

Health check: `GET http://localhost:4000/api/health` returns `{"status":"ok"}`.

Homepage sniff: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/` returns 200.

Start with `npm run dev` (concurrently runs both). `npm run dev:claude` starts then immediately stops — do NOT use for interactive browser checks.

Kill safely: `lsof -ti :4000 -sTCP:LISTEN | xargs kill` and `lsof -ti :4173 -sTCP:LISTEN | xargs kill`

**Why:** The `-sTCP:LISTEN` filter prevents accidentally killing browser sockets that share the same port in lsof output.
