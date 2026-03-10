---
name: alerting_monitoring
description: Analyze and improve alerting, notifications, reminders, monitoring, logging, health checks, and operational visibility.
---

# Skill: Alerting, Monitoring, and Operational Visibility

## Purpose
This skill enables the agent to analyze, design, and improve alert systems and monitoring layers that notify users or operators about important events.

The goal is reliable notifications, clear prioritization, strong observability, and minimal duplication or noise.

It is useful for systems with reminders, Telegram alerts, email alerts, push notifications, dashboards, health checks, status endpoints, logs, and operational monitoring.

## When to Use This Skill
Use this skill when the user asks to:

- Review alerts and reminders
- Diagnose noisy or missing notifications
- Improve monitoring and visibility
- Check health endpoints and operational status
- Validate event-triggered messaging logic
- Reduce alert spam
- Improve observability
- Review Telegram, email, or bot notifications
- Analyze whether alerts are actionable and reliable

Typical examples:
- "Check whether my alerts are correct."
- "Why am I getting too many notifications?"
- "Review my Telegram alert logic."
- "What monitoring is missing in this system?"

## Core Responsibilities
The agent should:

1. Review what events generate alerts
2. Validate trigger conditions and targeting
3. Evaluate alert quality and signal-to-noise ratio
4. Inspect delivery flow and retry behavior
5. Inspect reminder deduplication and persistence
6. Check operational monitoring coverage
7. Identify blind spots in visibility
8. Recommend practical alerting and observability improvements

## Required Capabilities

### 1. Alert Rule Definition
Each alert should have:
- trigger condition
- source data
- target user
- delivery method
- cooldown rules
- severity or priority level

The agent should verify that rules are explicit and correct.

### 2. Event Detection
Events may include:
- new messages
- homework deadlines
- approvals required
- absences
- equipment alerts
- scraper failures
- stale cache
- sync failures
- job failures

The agent should confirm that event detection matches intended system behavior.

### 3. Notification Delivery
Possible channels:
- Telegram bots
- email
- push notifications
- dashboards
- internal operator alerts

The agent should review:
- delivery reliability
- delivery confirmation
- retry attempts
- fallback behavior
- per-channel suitability

### 4. Duplicate Prevention and Reminder Idempotency
Prevent repeated alerts by:
- storing alert state
- deduplication keys
- cooldown timers
- persistence across restarts

The agent should:
- inspect persistence of sent reminders
- detect repeated alert risk after restart
- review idempotency of reminder logic
- identify spam loops or duplicated triggers

### 5. Alert Prioritization
Alerts should be categorized, for example:
- critical
- important
- informational

The agent should evaluate whether:
- critical issues are surfaced properly
- low-priority items are not too noisy
- users and operators receive the right level of urgency

### 6. Monitoring Coverage
Review operational visibility such as:
- health/status endpoints
- cache freshness
- sync health
- scraper success or failure
- job execution status
- queue or retry state
- last success timestamps

Detect missing metrics, missing health indicators, or blind spots.

### 7. Logging Review
All alerts and operational failures should log:
- timestamp
- event type
- delivery status
- retry attempts
- relevant identifiers

The agent should evaluate:
- whether logs are structured and meaningful
- whether failures are visible enough
- whether silent failures can occur

### 8. Operational Improvement Areas
Potential recommendations:
- better health endpoints
- alert throttling
- failure counters
- last-success timestamps
- stale-cache alerts
- scraper failure alerts
- delivery confirmation tracking
- separation between user-facing alerts and operator-facing alerts

## Methodology

Step 1 - Identify Event Sources  
Determine where alerts originate.

Step 2 - Validate Trigger Logic  
Confirm rules match intended behavior.

Step 3 - Evaluate Notification Flow  
Check delivery reliability and targeting.

Step 4 - Detect Noise or Missing Alerts  
Find spam, duplicates, blind spots, or suppressed failures.

Step 5 - Improve Alert Reliability and Monitoring  
Recommend operational improvements.

## Operating Rules
- Favor actionable alerts over noisy alerts
- Distinguish user-facing reminders from operator-facing monitoring
- Focus on operational usefulness, not just message sending
- Prefer explicit deduplication over assumption-based suppression
- Treat observability as part of reliability

## Output Style
Recommended sections:
1. Alert Inventory
2. Current Alert Types
3. Trigger Rules
4. Delivery Flow
5. Monitoring Coverage
6. Noise and Spam Risks
7. Blind Spots
8. Reliability Issues
9. Issues Detected
10. Recommended Monitoring Improvements
11. Improvement Plan

## Success Criteria
This skill succeeds when the user gets:
- a clear map of current alerts and trigger rules
- identification of noisy, missing, or weak alert logic
- stronger delivery and deduplication recommendations
- better operational visibility and observability
- a more trustworthy monitoring model