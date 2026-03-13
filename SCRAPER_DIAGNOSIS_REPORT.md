# Webtop Scraper — Diagnosis & Fix Report
**Date:** March 13, 2026  
**Project:** Webtop_APP (webtop.smartschool.co.il scraper)

---

## Executive Summary

| Item | Status |
|------|--------|
| **Root cause** | `push_scrape.mjs` missing — scheduled task failed repeatedly |
| **Fixes applied** | Created `push_scrape.mjs` wrapper |
| **Scraper engine** | Working (webtop_scrape.mjs + .webtop_profile) |
| **Cached data** | Present (data_cache.json — from 2026-03-04) |
| **Action required** | Update Windows Task Scheduler path if used |

---

## 1. Investigation Summary

### 1.1 What Was Checked

- **Project structure** — All scraper-related files inventoried
- **Error logs** — `push_scrape.log`, `scrape_err.log`, `scrape_debug*.log`
- **Scraper code** — `webtop_scrape.mjs`, `scrape_and_push.mjs`, `push_loop.mjs`
- **Server** — `server.js` (Express, cache, push API)
- **Configuration** — `.env`, `.env.example`, `children_config.json`
- **Browser profile** — `.webtop_profile/` (persistent session for reCAPTCHA bypass)

### 1.2 Key Findings

| Finding | Details |
|---------|---------|
| **push_scrape.mjs missing** | Windows Task Scheduler (or similar) was calling `node push_scrape.mjs` every 15 min from `C:\Users\Master_PC\Desktop\n8n\Webtop_APP\` — file did not exist |
| **Wrong path in scheduler** | Error path: `Desktop\n8n\Webtop_APP` vs actual project: `Desktop\Projects Eldad\01_Active_Projects\n8n\Webtop_APP` |
| **Scraper works when run manually** | `webtop_scrape.mjs` and `scrape_and_push.mjs` run successfully; logs show data for גונשרוביץ אמי and גונשרוביץ יולי |
| **Cache is valid** | `data_cache.json` contains recent notifications, messages, signoffs — 51 notifications |
| **USE_LOCAL_SCRAPER=false** | Server is in push mode — expects data from home machine, not VPS scraping |

---

## 2. Root Cause (Systematic Debugging)

### Phase 1: Evidence

**push_scrape.log** (repeated every 15 min):
```
Error: Cannot find module 'C:\Users\Master_PC\Desktop\n8n\Webtop_APP\push_scrape.mjs'
```

**Existing files:**
- `scrape_and_push.mjs` ✓ — full scrape + push logic
- `push_loop.mjs` ✓ — daemon (scrape every 15 min, poll for triggers)
- `webtop_scrape.mjs` ✓ — Playwright scraper
- `push_scrape.mjs` ✗ — **did not exist** (referenced by scheduler / bat)

### Phase 2: Pattern

- `push_scrape.bat` runs `node push_scrape.mjs`
- `server.js` message: *"run push_scrape.bat on the home computer"*
- No `push_scrape.mjs` in project → **scheduler / manual runs always failed**

### Phase 3: Fix

Create `push_scrape.mjs` that delegates to `scrape_and_push.mjs` (spawn as child process to avoid module timing issues).

---

## 3. Fixes Applied

### 3.1 Created `push_scrape.mjs`

**Path:** `C:\Users\Master_PC\Desktop\Projects Eldad\01_Active_Projects\n8n\Webtop_APP\push_scrape.mjs`

**Role:** Entry point for scheduled task and `push_scrape.bat`. Spawns `scrape_and_push.mjs`:

```javascript
const proc = spawn(process.execPath, [join(__dirname, 'scrape_and_push.mjs')], {
  cwd: __dirname,
  stdio: 'inherit',
  env: process.env,
});
```

### 3.2 Verified `push_scrape.bat`

Already exists and correctly calls `node push_scrape.mjs`. No changes needed.

---

## 4. Run Instructions

### 4.1 One-Shot Scrape + Push (Home Machine)

```batch
push_scrape.bat
```

Or:

```powershell
cd "C:\Users\Master_PC\Desktop\Projects Eldad\01_Active_Projects\n8n\Webtop_APP"
node push_scrape.mjs
```

### 4.2 Daemon (Continuous Push Every 15 Min)

```batch
start_daemon.bat
```

Runs `push_loop.mjs` — scrapes every 15 min and pushes to VPS.

### 4.3 First-Time Session Capture (If Session Expired)

```batch
capture_session.bat
```

Or:

```powershell
$env:WEBTOP_CAPTURE="true"; node webtop_scrape.mjs
```

Browser opens → log in manually → solve reCAPTCHA → profile saved to `.webtop_profile/`.

### 4.4 Direct Scraper (JSON to stdout)

```powershell
node webtop_scrape.mjs
```

---

## 5. Architecture Quick Reference

```
┌─────────────────┐     POST /api/push      ┌─────────────────┐
│  Home Machine   │ ──────────────────────► │  VPS (Express)  │
│                 │                         │  PORT 3001      │
│  push_loop.mjs  │   every 15 min          │  data_cache     │
│  push_scrape.mjs│   or on trigger          │  Telegram       │
│  webtop_scrape  │                         └────────┬────────┘
└─────────────────┘                                  │
       ▲                                              │ GET /api/data
       │                                              ▼
   .webtop_profile                              Phone / Web UI
   (Chrome profile)                             Dashboard
```

---

## 6. Windows Task Scheduler Fix (If Used)

If you use Task Scheduler to run `push_scrape`:

1. Open **Task Scheduler**.
2. Find the task that runs Webtop scrape/push.
3. Edit the action:
   - **Program:** `node` (or full path to `node.exe`)
   - **Arguments:** `push_scrape.mjs`
   - **Start in:** `C:\Users\Master_PC\Desktop\Projects Eldad\01_Active_Projects\n8n\Webtop_APP`
4. Save.

Alternatively, use `start_daemon.bat` in Startup so the daemon runs whenever you log in.

---

## 7. Current System Status (Before Fix)

| Component | Status | Notes |
|-----------|--------|-------|
| webtop_scrape.mjs | OK | Extracts data; uses headed mode by default (reCAPTCHA) |
| scrape_and_push.mjs | OK | Scrape + push logic |
| push_loop.mjs | OK | Daemon; spawns webtop_scrape |
| push_scrape.mjs | **Fixed** | Now exists; spawns scrape_and_push |
| .webtop_profile | OK | Session stored |
| .env | OK | Credentials / VPS_URL |
| data_cache.json | OK | Cached data present |
| Server (USE_LOCAL_SCRAPER) | Push mode | Expects push from home, not local scrape |

---

## 8. Recommendations

1. **Use `start_daemon.bat`** instead of Task Scheduler for continuous updates — simpler and runs in the correct directory.
2. **Check VPS connectivity** — ensure VPS is reachable (`VPS_URL` in `.env`).
3. **Re-capture session** if scraping fails with redirect to login — run `capture_session.bat`.
4. **Prefer push mode** — `USE_LOCAL_SCRAPER=false` is recommended when the school portal blocks headless scraping from the VPS.

---

## 9. Files Modified / Created

| File | Action | Description |
|------|--------|-------------|
| `push_scrape.mjs` | **Created** | Wrapper that spawns scrape_and_push.mjs |
| `SCRAPER_DIAGNOSIS_REPORT.md` | Created | This report |

---

**Report generated by systematic debugging (Phase 1–4).**
