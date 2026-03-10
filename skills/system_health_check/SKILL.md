---
name: system_health_check
description: Meta-skill that validates all other skills are functional and tests the entire WebtopKids system end-to-end.
---

# Skill: System Health Check (Meta-Skill)

## Purpose
This skill is a **meta-validator** that tests whether the entire WebtopKids system and all other skills are functioning correctly. It runs structured checks across every layer of the system and produces a pass/fail health report.

It acts as a "test suite" for the operational skills, verifying that each skill's domain is healthy.

## When to Use This Skill
Use this skill when the user asks to:

- Verify the entire system is working
- Run a health check or system test
- Check that all skills are in place and functional
- Diagnose why something stopped working
- Validate after a deployment or code change
- Get a system status overview

Typical examples:
- "Run a full system health check."
- "Are all skills working?"
- "Check everything is OK after the deploy."
- "Give me a system status report."

## Core Checks

### Check 1: Skills Integrity (references: engineering_system_audit)
Verify all skill directories exist and contain valid SKILL.md files.

**Steps:**
1. List `skills/` directory — expect 6 subdirectories
2. Read each `SKILL.md` — verify YAML frontmatter (name, description)
3. Verify CLAUDE.md references skills directory
4. Report: skill name, line count, status (OK / MISSING / MALFORMED)

**Pass criteria:** All 6 skills present, each has valid frontmatter and >50 lines.

### Check 2: Scraper Health (references: web_automation_reliability)
Verify the scraper can run and produce valid output.

**Steps:**
1. Check `.webtop_profile/` exists (browser session)
2. Check `children_config.json` has 2 children with names, grades, birthYear
3. If recent `scrape_output.json` exists (< 1 hour), validate its structure
4. Check output has: `ok: true`, `data.notifications` array, `data.classEventsByStudent` with 2+ keys, `data._debug.studentsFound` with 2 names

**Pass criteria:** Config valid, scraper output has per-child data for both students.

### Check 3: Data Integrity (references: school_portal_data_integrity)
Validate the scraped data is correctly separated per child.

**Steps:**
1. Read latest scrape output or API response
2. Verify `classEventsByStudent` has keys for both children
3. Verify `homeworkByStudent` has keys for both children
4. Verify `notifications` have different `student` values (not all same child)
5. Verify no notification has empty `student`, `date`, or `type`

**Pass criteria:** Data is separated per child, no cross-contamination.

### Check 4: Push/Sync Health (references: realtime_data_sync)
Verify the push pipeline is operational.

**Steps:**
1. Check VPS is reachable: `GET /api/data` returns JSON with `ok: true`
2. Check cache age: `extractedAt` should be < 30 minutes old
3. Check `push_loop.mjs` is running (or was last push recent)
4. Check `.env` has required keys: VPS_URL, PUSH_SECRET, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID

**Pass criteria:** VPS reachable, data fresh (< 30 min), env complete.

### Check 5: Alert System Health (references: alerting_monitoring)
Verify alerts are properly configured.

**Steps:**
1. Check `sent_reminders.json` exists and is valid JSON array
2. Check `isQuietHours()` function exists in server.js
3. Verify ALERT_TYPES_SET has all 6 types
4. Verify permanent dedup (`alert_` prefix) is used in sendNewAlerts
5. Check Telegram credentials are set in .env

**Pass criteria:** Dedup file valid, quiet hours implemented, credentials set.

### Check 6: Frontend Health
Verify the dashboard serves correctly.

**Steps:**
1. Check `public/index.html` exists and references `style.css` and `app.js`
2. Check `public/app.js` has `studentMatch()` function (fuzzy name matching)
3. Check `public/app.js` has `resolveForStudent()` function
4. Check `public/style.css` has `.logo-banner` styles

**Pass criteria:** All frontend files present with required functions.

## Output Format

Produce a table:

```
| # | Check                  | Status | Details                          |
|---|------------------------|--------|----------------------------------|
| 1 | Skills Integrity       | PASS   | 6/6 skills valid                 |
| 2 | Scraper Health         | PASS   | 2 students found, output valid   |
| 3 | Data Integrity         | PASS   | Per-child data separated         |
| 4 | Push/Sync Health       | PASS   | VPS reachable, data 5 min old    |
| 5 | Alert System Health    | PASS   | Quiet hours active, dedup OK     |
| 6 | Frontend Health        | PASS   | All files and functions present   |
```

Followed by:
- **Overall status:** ALL PASS / X FAILURES
- **Action items:** List any failed checks with recommended fixes

## Operating Rules

1. Run ALL checks, even if early ones fail
2. Report real status — never skip or assume "OK"
3. Include specific error details for any FAIL
4. Reference the relevant skill for each failed check
5. Suggest the next action for any failure
6. This skill should be run after every major deployment

## Success Criteria

- All 6 checks pass
- No stale data (cache < 30 min)
- Both children have separate data
- Alert dedup is working
- All skills are intact
