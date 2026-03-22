## Skills
The agent must use the skills located in the /skills directory whenever relevant.
These skills are operational guidance for audit, scraping reliability, synchronization, alert validation, and school portal data integrity.
Do not duplicate skill content in outputs. Apply them selectively based on the task phase.

## Active Data Pipeline (Home PC)

The **only** active scraping pipeline is:

```
start_daemon.bat → push_loop.mjs + webtop_api_fetch.py
```

- `push_loop.mjs` — runs every 15 min, spawns Python fetcher, POSTs to VPS
- `webtop_api_fetch.py` — fetches data via REST API using saved webToken (no browser)
- `watchdog.bat` — Task Scheduler only; restarts push_loop.mjs if crashed

**No Playwright browser. No keepalive. No Chrome window.**

## Session Recovery — Manual Emergency Only

`webtop_session_recovery_manual.mjs` is a **manual emergency tool only**.

- Use ONLY when webToken in `.webtop_session.json` has fully expired and cookie recovery (Telegram bookmarklet) has failed
- NEVER start it automatically via watchdog, startup script, Task Scheduler, or any hook
- After recovery: stop it manually (Ctrl+C); push_loop resumes automatically