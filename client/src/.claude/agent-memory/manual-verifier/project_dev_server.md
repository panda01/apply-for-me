---
name: project-dev-server
description: Dev server startup and lifecycle notes for apply-for-me
metadata:
  type: project
---

`npm run dev` — starts both servers concurrently (tsx watch for server, vite for client). Use this for interactive browser testing.

`npm run dev:claude` — runs `bash dev-claude.sh` which starts both servers, runs a health check, then STOPS them. Do NOT use when you need the server to stay up for Playwright/browser testing.

After starting with `npm run dev`, always verify with:
1. `curl -s http://localhost:4000/api/health` → `{"status":"ok"}`
2. `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/` → `200`

The Vite dev proxy forwards `/api/*` from port 4173 → port 4000, so browser tests can hit `http://localhost:4173/api/...` for network request assertions.

**How to apply:** Always start with `npm run dev` (not `dev:claude`) when interactive verification is needed, and always do the two-step health + homepage sniff before driving the browser.
