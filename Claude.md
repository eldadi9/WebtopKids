# Webtop App — Claude Instructions

## 🛡️ HARD INVARIANT — Owner-Admin Alerts (NEVER REMOVE)

Eldad is the app owner. His admin user MUST always receive Telegram alerts.

- **Identity**: name=`מנהל`, phone=`054-4956647`, **chatId=`7773889743`**, role=`admin`, children=`["יולי","אמי"]`, isOwner=`true`, expectsTelegram=`true`
- **Enforcement**: `users.mjs` exports `enforceOwnerInvariant()` (called by every `loadUsers()`). It self-heals `users.json` if any owner field is missing, wrong, or deactivated.
- **Anti-regression rules** (do NOT violate during any refactor, migration, or rewrite):
  1. Never remove `enforceOwnerInvariant()` or the call from `loadUsers()`.
  2. Never change the owner's phone or chatId without explicit confirmation from Eldad.
  3. Never add a silent `if (!chatId) return` to alert flows for the owner — must throw via `expectsTelegram` if alertable content exists.
  4. Never deploy without verifying owner-invariant is intact: `ssh root@webtop … "node -e 'import(\"/root/webtop/users.mjs\").then(m=>console.log(m.loadUsers().find(u=>u.isOwner)))'"`

Full context: `~/.claude/projects/c--Users-Master-PC-…/memory/project_owner_admin_invariant.md`

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

---

## יולי — Orchestrator

- כשמשתמש כותב **"יולי"** → הפעל `.claude/skills/orchestrator.md`
- יולי מנהל את כל ה-skills ומחליט על הסדר והתלויות
- Skills זמינים: AUDIT, SCRAPER, DATA, SYNC, ALERTS, HEALTH, DEPLOY
- לרשימה מלאה וסדר עדיפויות: ראה `.claude/skills/orchestrator.md`
- **לא לפרוס (DEPLOY) ללא אישור מפורש מהמשתמש**