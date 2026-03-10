---
name: realtime_data_sync
description: Review and improve data synchronization systems using polling, push, scheduled jobs, triggers, caches, and sync loops with focus on freshness, consistency, and isolation.
---

# Skill: Realtime Data Sync and Push-Pull Architecture Review

## Purpose
This skill enables the agent to design, analyze, and validate systems that keep application data synchronized with external sources using polling, push flows, webhooks, triggers, scheduled jobs, caches, or sync loops.

It is intended for architectures where one component extracts or produces data and another component stores, serves, or consumes it.

The goal is to ensure freshness, consistency, isolation, and graceful failure handling.

## When to Use This Skill
Use this skill when the user asks to:

- Review push/pull sync architecture
- Analyze polling and trigger flows
- Debug stale data issues
- Investigate refresh behavior
- Validate scheduled sync logic
- Understand cache update flow
- Review daemon or loop-based data movement
- Analyze event-driven updates
- Review live dashboards or background refresh systems

Typical examples:
- "Check how data moves between home machine and VPS."
- "Why is refresh not updating the latest data?"
- "Analyze my push loop and polling logic."
- "Review the sync architecture and risks."

## Core Responsibilities
The agent should:

1. Identify sync source and sync destination
2. Map update paths from source to consumers
3. Review scheduled, manual, and event-driven triggers
4. Evaluate cache behavior and freshness logic
5. Detect race conditions, stale state, and missed updates
6. Validate consistency and user isolation
7. Evaluate retry and failure handling
8. Explain the actual synchronization model clearly

## Required Capabilities

### 1. Sync Architecture Mapping
- Identify who produces data
- Identify who stores data
- Identify who serves data to clients
- Detect push, poll, webhook, trigger, and manual refresh flows
- Trace how data travels across services, jobs, and storage

### 2. Data Freshness Strategy
Possible strategies include:
- polling
- push architecture
- webhook triggers
- background workers
- scheduled refresh

The agent should determine:
- which strategy is actually used
- how freshness is measured
- where delay enters the system
- whether "real-time" is truly live or only near-real-time

### 3. Scheduling and Trigger Review
- Review intervals and timing assumptions
- Detect overlap risk between manual and scheduled runs
- Check pending-flag and polling-consumption logic
- Review external triggers such as alerts or webhook calls
- Detect missed triggers or duplicate execution paths

### 4. Cache Management and Freshness Review
Design and validate caching layers such as:
- memory cache
- file cache
- database persistence

Important factors:
- cache expiration
- refresh triggers
- invalidation rules
- last-good-data retention

The agent should:
- inspect cache timestamps
- detect stale data exposure
- evaluate behavior when source sync fails
- check whether stale data is shown silently

### 5. Consistency Guarantees
Ensure:
- no stale data is mistaken for fresh data
- no race conditions corrupt state
- timestamps remain consistent
- update order is understandable
- cross-user contamination does not occur
- shared data is handled explicitly

### 6. Failure Handling and Recovery
Handle cases such as:
- scraper failure
- network timeout
- API downtime
- failed push
- empty result
- partial refresh
- duplicate trigger

System should degrade gracefully.

The agent should identify missing:
- retry logic
- deduplication
- locks
- rollback or fallback logic
- visibility into last success

### 7. Multi-User Data Isolation
Ensure:
- each user receives correct data
- shared data is handled correctly
- no cross-user contamination occurs
- sync boundaries are clear per tenant, child, user, or environment

### 8. System Clarity
The skill should clearly explain:
- where truth lives
- who owns refresh
- how client refresh actually works
- which parts are eventual-consistency vs immediate-consistency
- what happens during degraded mode

## Methodology

Step 1 - Map Data Sources  
Identify origin of all data.

Step 2 - Trace Update Flow  
Determine how data travels through the system.

Step 3 - Detect Latency Points  
Find where updates get delayed or lost.

Step 4 - Improve Sync Strategy  
Choose or recommend a better refresh model.

Step 5 - Validate Data Freshness  
Confirm that freshness, consistency, and isolation hold in practice.

## Operating Rules
- Do not assume real-time means truly live
- Separate manual trigger flow from scheduled sync flow
- Distinguish transport success from data freshness success
- Prefer architecture clarity over vague sync wording
- Treat data isolation as part of sync correctness

## Output Style
Recommended sections:
1. Data Flow Diagram
2. Sync Topology
3. Source of Truth
4. Sync Model
5. Scheduled Flow
6. Manual Refresh Flow
7. Event Triggers
8. Cache Behavior
9. Failure Points
10. Reliability Risks
11. Recommended Improvements
12. Implementation Plan

## Success Criteria
This skill succeeds when the user gets:
- a full understanding of the sync design
- identification of stale-data and missed-trigger risks
- a clear explanation of refresh behavior
- confidence about isolation and consistency boundaries
- practical steps to improve reliability and freshness