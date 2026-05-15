# Multi-Parent Backlog — `feature/webtopkids-dev-multi-parent`

**Plan source:** `C:\Users\Master_PC\.claude\plans\zany-munching-swing.md`
**Audit report:** [vps-audit-2026-05-15.md](vps-audit-2026-05-15.md)
**Handoff prompt:** [HANDOFF.md](HANDOFF.md)
**Updated:** 2026-05-15

---

## Current Status

**Phase:** 1 — Stabilization + DEV environment
**Branch:** `feature/webtopkids-dev-multi-parent` (from `dev`)
**Production:** No changes. VPS running `https://webtop.egautomations.cloud/` normally.

---

## ✅ Completed

### Phase 0 — VPS Audit (2026-05-15)
- SSH access verified (key-based, no password)
- Full state audit of `/root/webtop/` — see [vps-audit-2026-05-15.md](vps-audit-2026-05-15.md)
- Backup created: `/root/backups/webtop_audit_2026-05-15.tar.gz` (62 KB), also downloaded locally to `backups/`
- Key findings:
  - Moran's chatId (`6642684065`) already in `TELEGRAM_EXTRA_CHAT_IDS` — no env change needed
  - `JWT_SECRET` and `TOKEN_ENC_KEY` already exist in VPS `.env`
  - VPS NOT a git repo — deploy via rsync (`deploy.ps1`)
  - Two users named "אלדד" — confirmed same person (admin role + parent role)
  - `PUSH_DEFAULT_USER_ID` points to parent (`a1057d56...`), not admin

### Phase 1A — Manifest verified
- `public/manifest.json` has `"start_url": "/"` ✓
- VPS manifest is identical ✓
- Root cause of "/login" issue: old PWA shortcut. Solution: user reinstalls PWA from root URL.

### Phase 1B — SKIPPED
- Moran already receiving alerts via `TELEGRAM_EXTRA_CHAT_IDS`. No action.

### Phase 1C — DEV environment
- `.env.dev` created (PORT=3002, DATA_PREFIX=dev, fresh JWT_SECRET + TOKEN_ENC_KEY)
- `users.dev.json` created (empty)
- `scripts/start-dev.cmd` + `scripts/start-dev.sh` created
- `server.js` patched: `loadEnv()` respects `DOTENV_PATH`, file paths use `DATA_PREFIX`
- `users.mjs` patched: respects `USERS_FILE_OVERRIDE`
- `push_loop.mjs` patched: `loadDotEnv()` respects `DOTENV_PATH` (parity)
- `.gitignore` updated: `.env.dev`, `users.dev.json`, `data_cache_dev_*.json`, `backups/`
- Smoke test: DEV runs on :3002, PROD runs on :3000 — no interference

### Phase 1D — Branch + backlog
- Created `feature/webtopkids-dev-multi-parent` from `dev`
- This file (`multi-parent-backlog.md`) created

---

## 🟡 In Progress

- **NONE — clean stop point before /compact**
- Next session resumes at Phase 2H (processAlertsForUser fixes)

## ✅ Completed in this session (2026-05-15)

- **Phase 2A** — `requireAuth` on 12 data endpoints + `getAuthenticatedUserCache` + `effectiveUserIdForRequest` + `AUTH_DISABLED` kill-switch + `ADMIN_UI_PASSWORD` validation
- **Phase 2A Fix-up 1** — Code Reviewer + Silent-Failure Hunter found 7 critical issues; all fixed
- **Phase 2A Fix-up 2** — Silent-Failure Hunter second pass found 8 more (privacy leaks); all fixed including per-parent filtering of `/api/children`, `/api/health`, `/api/status`
- **Phase 2B** — `public/app.js` `authFetch` helper + Bearer headers on all 13 `/api/` calls + 401 redirect to /login + boot-time auth guard

**DEV-verified end-to-end:**
- Admin login → sees both children
- Parent login → sees ONLY their own children (אמי hidden from יולי's parent)
- Anonymous /api/data → 401
- Parent /api/admin/users → 403

---

## ⏳ Pending — Phase 2 (DEV-first; deploy only after explicit approval)

### Phase 2C — COMPLETED 2026-05-15
- ✅ `scripts/set_admin_password.mjs` written and DEV-tested
- ✅ Supports TTY (masked) + piped (for scripted tests) modes
- ✅ Bcrypt cost 12, min 8 chars, confirms twice
- ✅ `--create` flag for new admin users
- ✅ `USERS_FILE_OVERRIDE` env var for DEV isolation
- ✅ E2E verified: created Test Admin in DEV, login returns JWT, /api/auth/me works

### Phase 2C details (kept for reference)
- Create `scripts/set_admin_password.mjs`
- Interactive CLI: prompts for phone, password
- bcrypt hash, updates `users.json`, sets status to `active`
- Test in DEV before applying to VPS
- **Why first:** before enforcing `requireAuth`, admin must have a working login

### Phase 2A + 2B — Auth enforcement
- `server.js`: add `requireAuth` to data endpoints (`/api/data`, `/api/insights`, `/api/schedule`, `/api/status`, `/api/health`, `/api/homework/*`, `/api/messages/read`, `/api/children/:name/photo`)
- `server.js`: in `getAuthenticatedData(req)`, allow admin fallback to `PUSH_DEFAULT_USER_ID`
- `public/app.js`: add `Authorization: Bearer <token>` header to all `/api/` fetches
- `public/app.js`: on 401 response → clear localStorage + redirect to `/login`
- `public/app.js`: on init, if no `wt_token` → redirect to `/login`
- **Risk:** If anything breaks, Eldad can't access dashboard. Mitigation: SSH access + 2C script run again.

### Phase 2H + 2G — Critical security bugs
- **2H (fan-out bug):** in `processAlertsForUser()` ([server.js:488-537](../../server.js#L488-L537)), pass `direct=true` for non-admin users to prevent telegram fan-out to other households
- **2G (data isolation):** in `resolveAuthenticatedUserCache()` and `getAuthenticatedData()`, ensure parent users see only their own cache (no fallback to `PUSH_DEFAULT_USER_ID`)

### Phase 2D + 2E — Admin + bookmarklet UIs
- `public/admin.html`: improve pending user display, show token status, password gate
- Create `public/bookmarklet.html`: explain how to drag bookmarklet, show user-specific phone embedded in script

### Phase 2F — push_loop validation
- Test with 2 fake users in DEV
- Verify `webtop_api_fetch.py` reads `WEBTOP_TOKEN_ARG` env var correctly
- Confirm per-user push isolates correctly

### Phase 2I — children isolation (OPTIONAL, can defer)
- Per-user `children_config_${userId}.json` instead of global

---

## 🚧 Blocked / Issues

(none currently)

---

## ⚠️ Known Concerns (from audit)

1. **18 PM2 restarts of webtop** — not investigated. Check `pm2 logs webtop --err --lines 100` next session.
2. **`409 Conflict` in Telegram polling** — possibly 2 instances running. Investigate.
3. **Manual scripts on VPS not in git**: `activate_pending_user.cjs`, `dedupe_users_by_phone.cjs`. Don't run blindly.
4. **`.env.bak-admin-` on VPS** — leftover backup. Don't touch.

---

## 📝 Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-15 | Use bookmarklet, NOT Webtop username+password | Trust: parents won't share credentials; security: leaked DB doesn't expose passwords |
| 2026-05-15 | Two-stage rollout: stabilize → multi-parent | Stage 1 is zero-risk; Stage 2 requires DEV testing before VPS |
| 2026-05-15 | `DATA_PREFIX=dev` for DEV isolation | Cleaner than separate folder; allows side-by-side testing |
| 2026-05-15 | Branch `feature/webtopkids-dev-multi-parent` from `dev` | Preserves uncommitted work, isolates new feature commits |
| 2026-05-15 | Admin user gets `PUSH_DEFAULT_USER_ID` fallback in `getAuthenticatedData` | Admin (Eldad's admin account) has no children of its own — needs fallback to parent cache |

---

## 🎯 Lessons / Skills to Extract

- **Pattern:** dual-env Node.js apps via `DOTENV_PATH` + `DATA_PREFIX` — worth a skill if we repeat this
- **Pattern:** admin role with fallback to default user_id — could generalize

(will populate as we discover more)

---

## 🔥 Critical Reminders

- **NEVER** deploy to VPS without explicit user approval ("deploy" / "פרוס" / "תעלה ל-prod")
- **ALWAYS** backup VPS state before deploy: `tar czf /root/backups/webtop_<date>.tar.gz ...`
- **Phase 2 work** runs in DEV first, validated manually, only then VPS
- **2C MUST come before 2A** to prevent locking admin out
- **Production state**: VPS on commit unknown (not git), running multi-user code but auth not enforced anywhere
