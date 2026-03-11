---
name: web_automation_reliability
description: Analyze and stabilize browser automation, scrapers, login flows, sessions, waits, selectors, anti-bot issues, extraction quality, and recovery logic.
---

# Skill: Web Automation Reliability and Scraper Stability

## Purpose
This skill enables the agent to design, analyze, and stabilize web automation systems such as scrapers, browser automation, and portal integrations.

It focuses on login handling, session persistence, retries, waits, DOM stability, anti-bot issues, extraction quality, and error recovery.

The goal is to ensure reliable data extraction even when websites include dynamic content, redirects, rate limits, or bot protection.

## When to Use This Skill
Use this skill when the user asks to:

- Diagnose scraper failures
- Fix unstable Playwright or browser automation
- Investigate login or session problems
- Improve automation resilience
- Handle CAPTCHA, session expiration, or retries
- Analyze timeout issues
- Review extraction logic from a website
- Reduce flaky behavior in scraping or browser flows
- Stabilize portal integrations

Typical examples:
- "Why does the scraper stop after login?"
- "Check why Playwright times out."
- "Make the automation more stable."
- "Review the login and session flow."

## Core Responsibilities
The agent should:

1. Inspect login flow
2. Review browser state and session persistence
3. Analyze waits, selectors, redirects, navigation, and retries
4. Detect timeout, race-condition, and anti-bot risks
5. Review extraction selectors and parsing fragility
6. Validate scraped data quality
7. Recommend reliability improvements and recovery strategies

## Required Capabilities

### 1. Login Flow Analysis
Understand how authentication works, including:
- form login
- cookies
- tokens
- session storage
- redirects
- multi-step login

The agent should:
- review how username and password are filled
- check submit logic
- detect CAPTCHA, disabled buttons, redirects, or invalid waits
- identify invalid assumptions about successful login

### 2. Session Persistence Review
Ensure sessions survive between runs.

Review possible mechanisms such as:
- persistent browser profiles
- stored cookies
- storage state
- encrypted session files
- token reuse
- refresh token logic

Detect:
- silent session expiration
- invalid state reuse
- brittle login recovery
- token or cookie handling mistakes

### 3. Navigation and Wait Strategy
Detect incorrect use of:
- waitForURL
- waitForLoadState
- fixed sleeps
- selector waits
- navigation assumptions

Flag:
- race conditions
- brittle timing assumptions
- premature extraction
- wrong redirect handling
- waits that are too broad or too narrow

Prefer:
- deterministic waits
- explicit page readiness checks
- resilient navigation conditions

### 4. Anti-Bot Mitigation
Identify problems such as:
- CAPTCHA
- IP reputation blocking
- headless browser detection
- rate limiting
- suspicious repeated login behavior

Possible stabilization methods may include:
- real browser mode
- user-agent rotation
- stealth plugins
- request pacing
- session reuse

The agent should recommend these only when justified by evidence.

### 5. DOM Stability and Extraction Reliability
Avoid brittle selectors.

Prefer:
- semantic selectors
- attribute-based selection
- stable DOM anchors
- fallback selectors

The agent should:
- review selectors and DOM assumptions
- detect fragile scraping logic tied to layout or text variations
- evaluate fallback coverage
- detect extraction tied too closely to visual structure

### 6. Data Validation
After scraping, the agent should verify:
- required fields exist
- whitespace is normalized
- encoding is valid
- language rendering is correct
- duplicates are removed
- extracted data matches expected structure

### 7. Error Recovery
Automation should support:
- retries
- partial recovery
- session refresh
- page reload fallback
- resume after transient failure
- debug screenshot or dump on failure
- structured logging for failure analysis

## Methodology

Step 1 - System Understanding  
Map login, navigation, and data sources.

Step 2 - Failure Identification  
Determine where automation fails.

Step 3 - Reliability Strategy  
Design resilient scraping patterns.

Step 4 - Stabilization  
Improve selectors, session handling, waits, and navigation.

Step 5 - Validation  
Confirm extracted data is correct, clean, and repeatable.

## Operating Rules
- Do not change site behavior assumptions without evidence
- Prefer deterministic waits over arbitrary sleep
- Prefer resilient selectors over visual guesses
- Distinguish login failure from navigation failure from extraction failure
- Separate anti-bot issues from general instability
- Recommend mitigation only when technically justified

## Output Style
Recommended sections:
1. Automation Goal
2. Automation Architecture
3. Current Flow
4. Failure Point
5. Identified Risks
6. Likely Root Causes
7. Reliability Improvements
8. Proposed Implementation

## Critical: Webtop-Specific Rules (2026-03-10)

### Headless Mode BREAKS Sessions
- reCAPTCHA detects headless Chromium and invalidates the session token
- Default MUST be **headed mode** (`WEBTOP_HEADLESS` defaults to false)
- Only set `WEBTOP_HEADLESS=true` if explicitly testing without reCAPTCHA
- The persistent browser profile (`.webtop_profile/`) stores cookies/session, but reCAPTCHA clears them in headless

### Cookie Consent Popup
- webtop.co.il shows a cookie consent popup on first page load after session expiry
- `dismissCookies()` runs automatically before and after login
- If consent is not dismissed, the page is blocked and scraping fails

### Dashboard Card Data is UNRELIABLE for Homework
- The dashboard "נושאי שיעור ושיעורי בית" card only shows TODAY's class schedule
- If today has no school, it returns "לא נמצאו נתונים."
- **NEVER rely on dashboard cards for homework data**
- Use homework-type NOTIFICATIONS instead — they contain 21 days of history with subject, date, and full homework text
- `homeworkByStudent` is built from notifications, not dashboard

### Session Expiry Pattern
- Sessions expire within hours (not days)
- When expired: scraper hits login page → reCAPTCHA blocks auto-submit → timeout
- Fix: run `WEBTOP_CAPTURE=true node webtop_scrape.mjs` to re-login manually
- push_loop.mjs detects login page and logs error (does not retry — needs manual intervention)

## Success Criteria
This skill succeeds when the user gets:
- a clear explanation of why the automation is unstable
- identification of brittle steps
- concrete reliability improvements
- safer login, session, and navigation logic
- better long-term scraper robustness