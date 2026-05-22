# WebtopKids 🎒

> Automated school portal monitor — fetches homework, alerts, and teacher messages from the Israeli Webtop SmartSchool portal and delivers real-time Telegram notifications to parents, separated per child.

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/Playwright-Automation-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev)
[![Telegram](https://img.shields.io/badge/Telegram-Bot%20API-2CA5E0?logo=telegram&logoColor=white)](https://core.telegram.org/bots)
[![Status](https://img.shields.io/badge/Status-Live%20on%20VPS-22C55E)](.)
[![Tests](https://img.shields.io/badge/Tests-17%2F17%20passing-22C55E)](.)

---

## The Problem

Israeli school parents have no unified alert system. Homework deadlines, teacher messages, grades, and event alerts sit inside the Webtop SmartSchool portal — with no push notifications. Parents miss deadlines and messages unless they actively log in.

## What I Built

An automated monitoring system that:

- Logs into the Webtop SmartSchool portal and extracts all relevant data
- Separates data per child (multi-child household support)
- Sends real-time Telegram notifications for:
  - New homework assignments with deadline reminders (3 days / 2 days / 1 day before)
  - Teacher messages and unread alerts
  - Grades, missing equipment, absences
  - Completion confirmation when a task is marked done
- Runs on a scheduled loop on VPS — fully automated, no manual checks needed

## Key Features

- Multi-child support — each child's data separated and labeled
- Smart deduplication — no repeated alerts for the same item
- Deadline reminder ladder — 3 days → 2 days → 1 day before submission
- Scheduled automation — runs continuously on VPS via cron
- 17/17 logic tests passing

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Automation | Node.js, Playwright |
| Notifications | Telegram Bot API |
| Scheduling | VPS cron / daemon |
| Data fetch | REST API + session management |
| Testing | Custom logic test suite (17/17) |

## Architecture

```
Scheduled trigger (VPS cron)
        ↓
   Portal data fetch
        ↓
   Per-child data separation
        ↓
   Deduplication & diff logic
        ↓
   Telegram notifications → Parent
```

## Status

**Live on VPS** — running continuously.  
Notifications delivered in real time. 17/17 tests passing.

## What This Proves

- Playwright-based portal automation at production level
- Telegram Bot API integration with smart notification logic
- VPS deployment with scheduled automation and daemon management
- Multi-entity data separation (per child)
- Practical automation solving a real daily parenting need

---

*Part of a portfolio of AI automation systems — [github.com/eldadi9](https://github.com/eldadi9)*
