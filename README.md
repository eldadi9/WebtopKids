<div align="center">

# WebtopKids 🎒

### Real-time school portal monitoring for busy families

WebtopKids turns the Israeli Webtop SmartSchool portal into a proactive notification system — automatically fetching homework, teacher messages, grades, absences, and school alerts, then delivering clean Telegram notifications organized per child.

<p align="center">
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js">
  </a>
  <a href="https://playwright.dev">
    <img src="https://img.shields.io/badge/Playwright-Automation-2EAD33?logo=playwright&logoColor=white" alt="Playwright">
  </a>
  <a href="https://core.telegram.org/bots">
    <img src="https://img.shields.io/badge/Telegram-Bot%20API-2CA5E0?logo=telegram&logoColor=white" alt="Telegram Bot API">
  </a>
  <img src="https://img.shields.io/badge/Status-Live%20on%20VPS-22C55E" alt="Status">
  <img src="https://img.shields.io/badge/Tests-17%2F17%20Passing-22C55E" alt="Tests">
  <img src="https://img.shields.io/badge/Multi--Child-Supported-8B5CF6" alt="Multi-child support">
  <img src="https://img.shields.io/badge/Notifications-Real--Time-0EA5E9" alt="Real-time notifications">
  <img src="https://img.shields.io/badge/Portfolio-Production--Style-111827" alt="Portfolio project">
</p>

<p align="center">
  <strong>Built to solve a real daily problem for parents through practical automation.</strong>
</p>

<p align="center">
  <a href="#installation"><strong>Get Started</strong></a>
  ·
  <a href="#feature-highlights"><strong>Explore Features</strong></a>
  ·
  <a href="#roadmap"><strong>View Roadmap</strong></a>
</p>

</div>

---

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Feature Highlights](#feature-highlights)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Installation](#installation)
- [Usage](#usage)
- [Project Status](#project-status)
- [Roadmap](#roadmap)
- [Why This Project Matters](#why-this-project-matters)
- [Call to Action](#call-to-action)

---

## Overview

WebtopKids is an automated monitoring system built for Israeli families who rely on the Webtop SmartSchool portal for school communication.

Instead of expecting parents to repeatedly log in and manually check for updates, the system monitors the portal automatically and sends important changes directly to Telegram in real time.

---

## The Problem

School communication is often passive.

Homework deadlines, unread teacher messages, grades, absences, and school alerts may exist inside the portal — but without a proactive notification layer, parents can easily miss them unless they remember to check manually.

Parents should not need to constantly poll a portal just to stay informed.

---

## The Solution

WebtopKids automates the full monitoring pipeline:

- Logs into the Webtop SmartSchool portal
- Fetches relevant student data automatically
- Separates all data per child for multi-child households
- Detects new or changed items
- Prevents duplicate alerts
- Sends real-time Telegram notifications to parents
- Reminds about homework deadlines 3, 2, and 1 day before submission
- Confirms when a task is marked as completed

This transforms a login-only school system into an always-on alerting workflow.

---

## Feature Highlights

<table>
  <tr>
    <td width="220"><strong>📚 Homework Monitoring</strong></td>
    <td>Detects new assignments and sends deadline reminders before submission.</td>
  </tr>
  <tr>
    <td><strong>💬 Teacher Messages</strong></td>
    <td>Surfaces teacher communication and unread alerts without requiring manual portal checks.</td>
  </tr>
  <tr>
    <td><strong>👨‍👩‍👧‍👦 Multi-Child Support</strong></td>
    <td>Separates and labels updates per child for households managing more than one student.</td>
  </tr>
  <tr>
    <td><strong>🔁 Smart Deduplication</strong></td>
    <td>Avoids repeated notifications for the same item through change-detection and diff logic.</td>
  </tr>
  <tr>
    <td><strong>📈 Academic & Attendance Signals</strong></td>
    <td>Tracks grades, absences, missing equipment, and other relevant school events.</td>
  </tr>
  <tr>
    <td><strong>✅ Completion Confirmation</strong></td>
    <td>Confirms when a task is marked as done, helping parents stay synchronized with progress.</td>
  </tr>
  <tr>
    <td><strong>⚙️ Fully Automated Runtime</strong></td>
    <td>Runs continuously on a VPS with scheduled execution and no manual intervention.</td>
  </tr>
</table>

---

## Architecture

```text
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

---

## Tech Stack

| Layer | Technology |
|------|------------|
| Automation | Node.js, Playwright |
| Notifications | Telegram Bot API |
| Scheduling | VPS cron / daemon |
| Data Fetching | REST API + session management |
| Testing | Custom logic test suite |

---

## Installation

> The exact runtime scripts may vary by local setup. The flow below reflects a standard Node.js installation path for this project.

### 1) Clone the repository

```bash
git clone <your-repository-url>
cd webtopkids
```

### 2) Install dependencies

```bash
npm install
```

### 3) Configure credentials and notification settings

Add your local configuration for:

- School portal authentication
- Telegram bot integration
- Child mapping / labeling logic
- Scheduling or daemon execution preferences

### 4) Prepare the runtime environment

Recommended:

- Node.js 18+
- A VPS or always-on machine for continuous monitoring
- A scheduler such as cron for recurring execution

### 5) Start the service

Run the application using the script defined in your local project configuration.

```bash
# Example only — replace with the actual script configured in package.json
npm run start
```

---

## Usage

Once configured, WebtopKids operates as a background monitoring workflow:

1. The scheduler triggers a monitoring cycle
2. The system logs into the Webtop portal
3. Relevant student data is fetched and normalized
4. Changes are compared against previously seen items
5. New or updated events are pushed to Telegram
6. Homework reminders are sent 3, 2, and 1 day before the deadline

### Typical use cases

- Stay updated on newly assigned homework
- Catch teacher messages without checking the portal manually
- Track grades, absences, and missing equipment events
- Manage notifications separately for multiple children in one household

---

## Project Status

**Live on VPS** and running continuously.

### Current status

- ✅ Real-time Telegram notifications active
- ✅ Multi-child separation working
- ✅ Deadline reminder ladder implemented
- ✅ Smart deduplication logic in place
- ✅ 17/17 tests passing

---

## Roadmap

The current system is already operational, with several natural directions for future expansion:

- [ ] Public project demo or sanitized walkthrough
- [ ] Dockerized deployment workflow
- [ ] Richer logging and observability
- [ ] Configurable notification preferences per child
- [ ] Expanded event classification and prioritization
- [ ] Historical activity summaries and reporting
- [ ] CI/CD hardening for automated deployment

---

## Why This Project Matters

WebtopKids is more than a technical demo.

It demonstrates how browser automation, notification systems, and production-style monitoring can solve a practical real-world problem: helping parents stay aligned with school communication without needing to constantly log into a portal.

This project highlights:

- Production-oriented Playwright automation
- Telegram Bot API integration
- Stateful change detection and alerting logic
- Multi-entity data separation
- VPS deployment and continuous operation
- Practical automation with real user value

---

## Call to Action

If this project resonates with you, feel free to connect, collaborate, or follow the work.

### You can:

- ⭐ Explore more automation projects
- 💡 Share product or feature ideas
- 🤝 Collaborate on bots, monitoring systems, and productivity tools

**Portfolio:** [github.com/eldadi9](https://github.com/eldadi9)

---

<div align="center">
  <sub>Built as part of a broader portfolio of practical automation systems.</sub>
</div>
