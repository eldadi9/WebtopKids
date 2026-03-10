---
name: school_portal_data_integrity
description: Validate school portal data quality, student separation, parsing accuracy, normalization, deduplication, freshness, and parent-facing trustworthiness.
---

# Skill: School Portal Data Integrity and Parent-Facing Accuracy Review

## Purpose
This skill ensures that data extracted from school portals is accurate, clean, consistent, correctly classified, and correctly associated with the right student before it is shown in the application, exposed through APIs, or used for alerts.

It focuses on data quality, formatting correctness, source fidelity, classification accuracy, and preventing corrupted, misleading, or cross-student information inside the application.

The goal is that the application reflects the real school portal information with high fidelity and is safe to present to parents or family dashboards.

## When to Use This Skill
Use this skill whenever the system processes data coming from a school portal or external educational platform.

Typical data types:
- scraped homework data
- school messages
- approvals
- events
- grades
- absence alerts
- equipment alerts
- schedules
- student-specific records

Use this skill when the user asks to:
- verify extracted school data accuracy
- detect wrong subject or wrong student mapping
- review homework, event, or grade parsing
- validate parent-facing dashboard data
- inspect classification logic
- check whether the app may show misleading school information
- validate API responses before displaying them in the UI or sending alerts

Typical examples:
- "Why is the app showing a lesson that does not exist?"
- "Check whether homework is mapped to the right child."
- "Review data quality from the school portal."
- "Audit the integrity of extracted school notifications."

## Core Responsibilities
The agent should:

1. Review extracted educational data structure
2. Confirm data matches the portal source
3. Validate parsing and classification logic
4. Detect wrong mapping between student, subject, date, and event type
5. Normalize corrupted or inconsistent text
6. Validate required fields and API output quality
7. Detect duplicates and stale data
8. Identify misleading or low-confidence data
9. Evaluate parent-facing trustworthiness
10. Recommend stronger validation and integrity rules

## Core Principles

### 1. Data Must Match the Source
Data must accurately reflect the school portal.

The system must detect and avoid:
- missing fields
- truncated text
- incorrect message bodies
- incorrect subject names
- mismatched dates
- wrong lesson mapping
- incorrect event classification

Portal facts must be separated from parser assumptions.

### 2. Student Isolation
Data must always belong to the correct student.

Rules:
- Yuli data must never appear in Ami views
- Ami data must never appear in Yuli views
- shared items must be explicitly marked as shared

The system must detect leakage between students and validate switching logic or per-student extraction flow.

### 3. Text Normalization
Data from portals often contains formatting issues.

The system must normalize:
- extra whitespace
- broken Hebrew text
- newline inconsistencies
- HTML remnants
- encoding issues
- malformed portal formatting

Normalization examples:
- trim whitespace
- collapse multiple spaces
- normalize line breaks
- sanitize HTML
- ensure correct language rendering

### 4. Field Validation
Every extracted object must be validated.

Example structures:

Homework item:
- subject
- description
- due_date
- teacher
- status

Message item:
- title
- body
- sender
- date
- read_status

Additional extracted fields may include:
- student
- lesson
- category
- alert time
- event type

If required fields are missing, malformed, or ambiguous, the item should be flagged.

### 5. Classification Accuracy
The system should evaluate type detection such as:
- homework
- absence
- late
- missing equipment
- grade
- homework not done
- class event
- approval request

The agent should detect ambiguous or misclassified cases and avoid presenting uncertain inferences as certain facts.

### 6. Duplicate Prevention
Scraping pipelines may produce duplicate entries.

The system must detect duplicates using:
- message id
- timestamp
- content hash
- subject + date combination

Duplicates must not be displayed or alerted twice.

### 7. Clean API Output
Before returning data to the API, the system must ensure:
- valid JSON
- normalized strings
- no corrupted characters
- correct language encoding
- consistent field names
- safe handling of unknown or partial fields

### 8. Alert Data Validation
Alerts must only be generated when the underlying data is verified.

Correct example:
New homework detected with valid due date.

Incorrect example:
Alert triggered on malformed, partial, duplicated, or low-confidence data.

### 9. Data Freshness Verification
The system should verify that the data is recent.

Checks may include:
- last update timestamp
- portal fetch timestamp
- cache age

If data becomes stale, the system should trigger a refresh or clearly mark the data as stale.

### 10. Parent-Facing Trust Review
The system must identify where the UI may show false, incomplete, or overly certain information.

It should:
- flag low-confidence fields
- detect when raw portal text is too ambiguous for clean display
- prefer safe and correct over polished but wrong
- use fallback-to-raw-text when classification confidence is weak

### 11. Data Integrity Safeguards
Possible safeguards include:
- confidence scoring
- fallback to raw text
- explicit unknown-field handling
- stronger subject validation
- deduplication rules
- per-student consistency checks
- validation against known child subjects

## Methodology

Step 1 - Data Source Mapping  
Identify where each data element originates in the portal.

Step 2 - Extraction Validation  
Confirm that scraped elements match expected structure and portal source.

Step 3 - Data Cleaning  
Normalize text and remove formatting artifacts.

Step 4 - Integrity Verification  
Ensure each item belongs to the correct student, contains valid fields, and is classified correctly.

Step 5 - Freshness and Duplicate Validation  
Verify that records are recent and not duplicated.

Step 6 - API Preparation  
Prepare consistent, validated objects before returning them to the application.

Step 7 - Parent-Facing Safety Review  
Ensure that only trustworthy data is shown as fact in the UI or used for alerts.

## Operating Rules
- Parent-facing educational data must be treated as high trust and low ambiguity
- Do not present inferred data as certain when parsing is weak
- Separate portal facts from parser assumptions
- Prefer safe and correct over polished but wrong
- Student separation is mandatory
- Data should be validated before alerts or UI display

## Output Style
When auditing data quality, produce a report including:

1. Data Sources
2. Extracted Data Types
3. Extraction Accuracy
4. Parsing Logic Review
5. Formatting Issues
6. Classification Risks
7. Duplicate Detection
8. Student Mapping Validation
9. Data Freshness Review
10. Parent-Facing Accuracy Concerns
11. Data Integrity Risks
12. Recommended Integrity Improvements

## Critical Data Pulling Rules (WebtopKids)

**This is the most important function of the app — data must be up-to-date, correct, and verified.**

### Per-Student Extraction (MANDATORY)
- Data pulling ALWAYS runs **twice** — once per child, separately
- The scraper MUST switch students via the portal dropdown before each extraction
- After switching, the scraper MUST verify the switch succeeded (read back selected name)
- If switch fails, retry after full page reload; if still fails, SKIP (never store wrong child's data)
- ALL per-student data types: classEvents, homework, grades, notifications, schoolEvents
- Only **messages** are shared (fetched once — they are for parents, not per-child)

### Data Freshness
- Notification window: **21 days** (3 weeks back) — not 7 days
- Homework: only show if due date is today or future
- Dashboard data (homework/grades cards): extracted fresh on every scrape per-child
- Stats and insights: always filtered by currently selected student
- Server stale alert filter: skip non-grade alerts > 7 days old (for Telegram only, not display)

### Student Name Matching
- Portal notifications use **short names** (e.g., "אמי")
- Config uses **full names** (e.g., "גונשרוביץ אמי")
- ALL filtering must use fuzzy matching: `studentMatch()` / `resolveForStudent()`
- Never use strict equality (`===`) for student name comparisons in display logic

### Verification Checklist
After every scrape, verify:
1. `_debug.studentsFound` contains both children
2. `classEventsByStudent` has keys for both children with DIFFERENT data
3. `notifications` array has entries for both children (different `student` values)
4. `homeworkByStudent` and `gradesByStudent` have keys for both children
5. No single child has ALL the data while the other has none

## Success Criteria
This skill succeeds when the user gets:
- clear visibility into data quality risks
- identification of wrong, stale, duplicated, or ambiguous mappings
- safer parent-facing display guidance
- stronger validation and normalization recommendations
- practical integrity improvements for the school portal app
- **verified per-child data separation with no cross-contamination**
- **up-to-date data within the 21-day window**