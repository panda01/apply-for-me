# Manual Verifier Memory

- [Project ports and health check](project_ports_health.md) — server :4000, client :4173; health at GET /api/health
- [Prisma DB access pattern](project_prisma_db_access.md) — SQLite table is jobs_listing (not job_listings); use better-sqlite3 directly for throwaway scripts
- [MUI Tooltip on disabled button](feedback_tooltip_disabled_button.md) — hover target must be the span wrapper, not the disabled button; aria-label on the clone span proves tooltip text
- [Dev server startup](project_dev_server.md) — npm run dev starts both servers; dev:claude starts then stops (don't use for interactive checks)
