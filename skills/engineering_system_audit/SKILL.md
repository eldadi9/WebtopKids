---
name: engineering_system_audit
description: Deep technical audit of software systems including architecture, runtime validation, code quality, risk analysis, and structured engineering reporting.
---

# Skill: Engineering System Audit and Structured Analysis

## Purpose
This skill enables the agent to perform deep technical analysis of a software system, combining code inspection, runtime validation, architecture review, standards evaluation, and structured engineering reporting.

It is used when the task requires real investigation and concrete technical assessment, not only theoretical explanation.

The agent must inspect files, identify flows, validate behavior, detect weak points, compare implementation against best practices, and produce a clear system-level assessment.

## When to Use This Skill
Use this skill when the user asks to:

- Analyze an existing software project
- Understand a codebase that is already mid-development
- Diagnose system failures or instability
- Perform code review
- Audit architecture and system design
- Validate runtime behavior
- Evaluate data quality
- Review backend, frontend, scripts, workers, or automations
- Identify missing components, broken flows, or hidden risks
- Produce an engineering audit report
- Assess implementation maturity
- Compare system behavior to industry standards

Typical examples:
- "Scan this project and tell me how it works."
- "Analyze the system and tell me why it stopped working."
- "Audit the architecture and explain what is broken."
- "Review this automation project without changing anything."

## Core Responsibilities
The agent should:

1. Inspect project structure
2. Understand the system goal
3. Map major flows and dependencies
4. Validate behavior against expected operation
5. Detect implemented vs missing areas
6. Identify technical risks and weak points
7. Retrieve and apply relevant engineering best practices
8. Validate assumptions against actual files and runtime evidence
9. Produce structured and actionable findings

## Required Capabilities

### 1. File and Structure Analysis
- Scan directories and files
- Read source files
- Identify main entry points
- Detect backend, frontend, scripts, configs, and deployment files
- Recognize naming conventions and module boundaries
- Map dependencies between modules

### 2. Architecture Mapping
- Map system layers
- Identify data flow between modules
- Detect external integrations
- Understand runtime model and orchestration
- Identify boundaries between services, workers, UI, APIs, and storage layers

### 3. Runtime and Behavior Validation
When safe and appropriate, the agent may:

- review scripts and execution paths
- inspect runtime behavior
- execute test scripts
- run diagnostic tools
- validate API responses
- confirm service health
- detect likely runtime failures

The agent should identify issues such as:
- timeout problems
- auth failures
- retry issues
- parsing failures
- invalid state transitions
- broken startup assumptions

### 4. Standards and Best Practices Retrieval
The agent should retrieve and apply relevant engineering standards, including:

- software architecture best practices
- reliability and fault tolerance patterns
- API design standards
- automation workflow patterns
- observability and monitoring standards
- DevOps stability patterns
- maintainability and modularity guidelines

### 5. Code Quality and Reliability Review
- Identify brittle logic
- Detect tight coupling and duplication
- Detect unclear ownership or hidden side effects
- Flag weak error handling
- Flag missing validation, logging, monitoring, fallback behavior, or recovery logic
- Evaluate maintainability and stability risks

### 6. Systematic Analysis Methodology

Step 1 - System Understanding  
Identify the system's purpose, architecture, and main components.

Step 2 - Behavior Verification  
Determine whether the system behaves as expected.

Step 3 - Deviation Detection  
Identify mismatches between expected and actual behavior.

Step 4 - Root Cause Analysis  
Determine the technical causes of failures, instability, or missing behavior.

Step 5 - Corrective Strategy  
Propose practical repair or improvement strategies.

## Structured Evaluation Output
The output should be structured and actionable.

It should include:
- system overview
- project goal
- architecture summary
- main execution flows
- important files and responsibilities
- observed behavior
- working parts
- partial parts
- missing parts
- identified issues
- root causes
- risk analysis
- recommended fix strategy
- implementation plan or next steps

## Operating Rules
- Do not modify or delete code unless explicitly asked
- Do not expose secrets or credentials
- Base conclusions on actual evidence from files or safe diagnostics
- Separate facts from assumptions
- Prefer structured analysis over vague summaries
- Avoid speculation without supporting evidence
- Prioritize system stability and maintainability

## Output Style
The final output should be clear, structured, and engineering-oriented.

Recommended sections:
1. Project Goal
2. System Overview
3. Current Architecture
4. Main Execution Flows
5. Important Files
6. Current Behavior
7. What Works
8. What Is Partial
9. What Is Missing
10. Issues Identified
11. Root Cause Analysis
12. Risks and Weak Points
13. Recommended Fix Strategy
14. Implementation Plan

## Example Application
Automated Code Review

Input:
A developer submits a pull request.

Agent actions:
- read modified files
- run linters
- execute tests
- detect issues
- generate structured feedback

Output:
A technical review report highlighting code quality, risks, and suggested improvements.

## Success Criteria
This skill succeeds when the user gets:
- a real understanding of the project
- a map of how the system works
- clear identification of risks, failures, and missing pieces
- evidence-based root cause analysis
- actionable technical direction for continuation or repair