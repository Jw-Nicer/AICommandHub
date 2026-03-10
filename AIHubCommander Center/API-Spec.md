# API-Spec.md — Supabase Edge Functions & Endpoint Specification

**Version:** 1.0
**Author:** Johnwil
**Date:** 2026-03-10
**Parent Document:** [Claude.md](./Claude.md)

---

## 1. Overview

All agent-to-system communication flows through Supabase Edge Functions deployed as Deno-based serverless handlers. This document defines every endpoint, its request/response schema, authentication requirements, error handling, and rate limits.

**Base URL:** `https://<project-ref>.supabase.co/functions/v1`

**Auth:** All endpoints require a valid Supabase JWT in the `Authorization: Bearer <token>` header unless marked as public.

---

## 2. Endpoint Registry

| # | Endpoint | Method | Purpose | Auth Required |
|---|---|---|---|---|
| 1 | `/submit-approval` | POST | Agent submits work for approval | Yes |
| 2 | `/decide` | POST | User approves/rejects/modifies an approval | Yes |
| 3 | `/register-agent` | POST | New surface registers itself | Yes |
| 4 | `/heartbeat` | POST | Agent reports it's alive | Yes |
| 5 | `/query-memory` | POST | Agent reads shared memory | Yes |
| 6 | `/write-memory` | POST | Agent writes to shared memory | Yes |
| 7 | `/assign-task` | POST | Orchestrator assigns a task to an agent | Yes |
| 8 | `/complete-task` | POST | Agent reports task completion | Yes |
| 9 | `/lock-resource` | POST | Agent requests a file/resource lock | Yes |
| 10 | `/unlock-resource` | POST | Agent releases a lock | Yes |
| 11 | `/get-queue` | GET | Mobile app fetches pending approvals | Yes |
| 12 | `/get-dashboard` | GET | Mobile app fetches agent status & metrics | Yes |
| 13 | `/batch-decide` | POST | User approves/rejects multiple items at once | Yes |
| 14 | `/conflict-report` | POST | Agent reports a detected conflict | Yes |

---

## 3. Endpoint Specifications

### 3.1 POST `/submit-approval`

Agents call this when they have work that needs approval before execution.

**Request:**

```json
{
  "agent_name": "string (required)",
  "surface_id": "uuid (optional, resolved from agent_name if omitted)",
  "task_id": "uuid (optional, links to parent task)",
  "title": "string (required, max 200 chars)",
  "description": "string (optional, max 5000 chars)",
  "diff_payload": {
    "type": "string (code_diff | file_change | data_change | document | other)",
    "files_changed": "integer",
    "insertions": "integer",
    "deletions": "integer",
    "preview": "string (first 500 lines of diff)",
    "full_diff_url": "string (optional, link to full diff)",
    "structured_data": "object (optional, for non-code changes)"
  },
  "risk_level": "string (low | medium | high | critical)",
  "requires_approval_before": "string (commit | deploy | execute | publish)",
  "expires_at": "ISO 8601 timestamp (optional, default: 1 hour from now)",
  "metadata": {
    "branch": "string (optional)",
    "repo": "string (optional)",
    "file_paths": ["string array (optional)"],
    "tags": ["string array (optional)"]
  }
}
```

**Response (201 Created):**

```json
{
  "approval_id": "uuid",
  "status": "pending",
  "queue_position": 3,
  "estimated_review_time": "30s",
  "created_at": "ISO 8601 timestamp"
}
```

**Response (400 Bad Request):**

```json
{
  "error": "validation_error",
  "message": "title is required and must be under 200 characters",
  "field": "title"
}
```

**Response (409 Conflict):**

```json
{
  "error": "resource_locked",
  "message": "src/auth.js is currently locked by claude-code",
  "locked_by": "claude-code",
  "lock_expires_at": "ISO 8601 timestamp"
}
```

---

### 3.2 POST `/decide`

User submits a decision on a pending approval. Called from the mobile PWA.

**Request:**

```json
{
  "approval_id": "uuid (required)",
  "decision": "string (approved | rejected | modified)",
  "decision_note": "string (optional, max 2000 chars)",
  "modifications": {
    "revised_diff": "object (optional, if user modified the work)",
    "instructions": "string (optional, text instructions back to agent)"
  }
}
```

**Response (200 OK):**

```json
{
  "approval_id": "uuid",
  "status": "approved",
  "decided_at": "ISO 8601 timestamp",
  "agent_notified": true
}
```

**Side Effects:**
- Updates `approval_queue.status` and `approval_queue.decided_at`
- Sends Realtime event on `agent-bus:approvals` channel
- If `modified`, creates a follow-up entry in `approval_queue` for the revision

---

### 3.3 POST `/register-agent`

New execution surface registers itself with the system.

**Request:**

```json
{
  "name": "string (required, unique identifier like 'antigravity-ide')",
  "type": "string (required: terminal | desktop | browser | mobile | ide)",
  "capabilities": ["string array (code | files | data | research | deploy)"],
  "metadata": {
    "version": "string (optional)",
    "platform": "string (optional)",
    "max_concurrent_tasks": "integer (optional, default: 1)"
  }
}
```

**Response (201 Created):**

```json
{
  "surface_id": "uuid",
  "name": "antigravity-ide",
  "api_key": "string (scoped key for this agent)",
  "created_at": "ISO 8601 timestamp"
}
```

**Response (409 Conflict):**

```json
{
  "error": "agent_exists",
  "message": "An agent named 'antigravity-ide' is already registered",
  "existing_surface_id": "uuid"
}
```

---

### 3.4 POST `/heartbeat`

Agents ping every 60 seconds to signal availability.

**Request:**

```json
{
  "surface_id": "uuid (required)",
  "status": "string (active | busy | idle)",
  "current_tasks": ["uuid array (task IDs currently being worked on)"],
  "load": {
    "cpu_percent": "number (optional)",
    "memory_percent": "number (optional)",
    "queue_depth": "integer (optional)"
  }
}
```

**Response (200 OK):**

```json
{
  "acknowledged": true,
  "pending_assignments": [
    {
      "task_id": "uuid",
      "title": "string",
      "priority": 2
    }
  ],
  "pending_decisions": [
    {
      "approval_id": "uuid",
      "decision": "approved",
      "instructions": "string or null"
    }
  ]
}
```

The heartbeat response doubles as a polling fallback — if Realtime is down, agents still get assignments and decisions through heartbeat responses.

---

### 3.5 POST `/query-memory`

Agent reads from the shared memory table before starting work.

**Request:**

```json
{
  "domain": "string (required: codebase | project | decision | context)",
  "key_pattern": "string (required, supports SQL LIKE syntax: 'api:auth:%')",
  "limit": "integer (optional, default: 10, max: 50)",
  "min_confidence": "float (optional, default: 0.5)",
  "created_by": "string (optional, filter by agent)"
}
```

**Response (200 OK):**

```json
{
  "entries": [
    {
      "id": "uuid",
      "key": "api:auth:strategy",
      "value": { "approach": "JWT with refresh tokens" },
      "confidence": 0.95,
      "created_by": "claude-code",
      "updated_at": "ISO 8601 timestamp"
    }
  ],
  "total_count": 3,
  "has_conflicts": false
}
```

---

### 3.6 POST `/write-memory`

Agent contributes knowledge to shared memory after completing approved work.

**Request:**

```json
{
  "surface_id": "uuid (required)",
  "domain": "string (required)",
  "key": "string (required, namespaced like 'project:api:auth-strategy')",
  "value": "object (required)",
  "confidence": "float (optional, default: 1.0, range: 0.0–1.0)",
  "source_approval_id": "uuid (optional, links to the approval that generated this knowledge)"
}
```

**Response (201 Created):**

```json
{
  "memory_id": "uuid",
  "conflict_detected": false,
  "created_at": "ISO 8601 timestamp"
}
```

**Response (409 Conflict):**

```json
{
  "memory_id": "uuid",
  "conflict_detected": true,
  "conflicting_entry": {
    "id": "uuid",
    "key": "project:api:auth-strategy",
    "value": { "approach": "session-based auth" },
    "created_by": "chatgpt",
    "confidence": 0.8
  },
  "resolution": "queued_for_review",
  "approval_id": "uuid (approval created for user to resolve conflict)"
}
```

---

### 3.7 POST `/assign-task`

Orchestrator (or user via mobile) assigns a task to a specific agent.

**Request:**

```json
{
  "task_id": "uuid (optional, creates new task if omitted)",
  "title": "string (required if new task)",
  "description": "string (optional)",
  "assigned_surface": "uuid (required)",
  "priority": "integer (1–5, default: 3)",
  "parent_task_id": "uuid (optional, for subtasks)",
  "depends_on": ["uuid array (optional, task IDs that must complete first)"],
  "metadata": {
    "estimated_duration_min": "integer (optional)",
    "tags": ["string array (optional)"]
  }
}
```

**Response (201 Created):**

```json
{
  "task_id": "uuid",
  "status": "assigned",
  "assigned_to": "antigravity-ide",
  "created_at": "ISO 8601 timestamp"
}
```

---

### 3.8 POST `/complete-task`

Agent reports that a task is done.

**Request:**

```json
{
  "task_id": "uuid (required)",
  "surface_id": "uuid (required)",
  "outcome": "string (success | failure | partial)",
  "output": {
    "summary": "string",
    "files_created": ["string array"],
    "files_modified": ["string array"],
    "artifacts": "object (optional, any structured output)"
  },
  "duration_ms": "integer",
  "memory_entries": [
    {
      "domain": "string",
      "key": "string",
      "value": "object",
      "confidence": "float"
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "task_id": "uuid",
  "status": "done",
  "memory_entries_written": 2,
  "next_tasks_unblocked": ["uuid array"],
  "completed_at": "ISO 8601 timestamp"
}
```

---

### 3.9 POST `/lock-resource`

Agent requests exclusive access to a file or resource.

**Request:**

```json
{
  "surface_id": "uuid (required)",
  "resource_type": "string (file | table | api_endpoint | domain)",
  "resource_path": "string (required, e.g., 'src/middleware/auth.js')",
  "duration_minutes": "integer (optional, default: 60, max: 240)"
}
```

**Response (200 OK):**

```json
{
  "lock_id": "uuid",
  "resource_path": "src/middleware/auth.js",
  "locked_by": "claude-code",
  "expires_at": "ISO 8601 timestamp"
}
```

**Response (423 Locked):**

```json
{
  "error": "already_locked",
  "locked_by": "openai-codex",
  "locked_at": "ISO 8601 timestamp",
  "expires_at": "ISO 8601 timestamp"
}
```

---

### 3.10 POST `/unlock-resource`

Agent releases a lock after finishing work.

**Request:**

```json
{
  "lock_id": "uuid (required)",
  "surface_id": "uuid (required)"
}
```

**Response (200 OK):**

```json
{
  "unlocked": true,
  "resource_path": "src/middleware/auth.js"
}
```

---

### 3.11 GET `/get-queue`

Mobile app fetches the current approval queue.

**Query Parameters:**
- `status` — filter by status (pending | approved | rejected | all), default: pending
- `risk_level` — filter by risk (low | medium | high | critical | all), default: all
- `agent_name` — filter by agent, default: all
- `limit` — max items, default: 20, max: 100
- `offset` — pagination offset, default: 0

**Response (200 OK):**

```json
{
  "items": [
    {
      "id": "uuid",
      "agent_name": "claude-code",
      "title": "Refactor auth middleware",
      "risk_level": "medium",
      "status": "pending",
      "requested_at": "ISO 8601",
      "expires_at": "ISO 8601",
      "diff_summary": {
        "files_changed": 4,
        "insertions": 87,
        "deletions": 42
      }
    }
  ],
  "total_count": 8,
  "pending_count": 3,
  "high_risk_count": 1
}
```

---

### 3.12 GET `/get-dashboard`

Mobile app fetches system-wide metrics and agent health.

**Response (200 OK):**

```json
{
  "agents": [
    {
      "surface_id": "uuid",
      "name": "claude-code",
      "status": "active",
      "current_task": "Refactoring auth module",
      "last_heartbeat": "ISO 8601",
      "tasks_completed_today": 7
    }
  ],
  "queue_metrics": {
    "pending": 3,
    "approved_today": 15,
    "rejected_today": 2,
    "avg_response_time_seconds": 22
  },
  "memory_metrics": {
    "total_entries": 145,
    "conflicts_today": 1,
    "domains_active": ["codebase", "project", "decision"]
  },
  "task_metrics": {
    "in_progress": 4,
    "completed_today": 12,
    "blocked": 1,
    "avg_completion_minutes": 18
  }
}
```

---

### 3.13 POST `/batch-decide`

User approves or rejects multiple approval items at once (for low-risk batch mode).

**Request:**

```json
{
  "decisions": [
    {
      "approval_id": "uuid",
      "decision": "approved",
      "decision_note": "string (optional)"
    },
    {
      "approval_id": "uuid",
      "decision": "approved"
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "processed": 2,
  "results": [
    { "approval_id": "uuid", "status": "approved" },
    { "approval_id": "uuid", "status": "approved" }
  ]
}
```

---

### 3.14 POST `/conflict-report`

Agent detects a conflict with another agent's work and escalates.

**Request:**

```json
{
  "reporting_agent": "string (required)",
  "conflict_type": "string (file_collision | semantic_contradiction | duplicate_task)",
  "resource": "string (file path, memory key, or task description)",
  "other_agent": "string (the agent being conflicted with)",
  "details": "string (description of the conflict)",
  "suggested_resolution": "string (optional)"
}
```

**Response (201 Created):**

```json
{
  "conflict_id": "uuid",
  "approval_id": "uuid (approval created for user to resolve)",
  "both_agents_paused": true
}
```

---

## 4. Error Codes

| HTTP Code | Error Key | Meaning |
|---|---|---|
| 400 | `validation_error` | Missing or invalid request fields |
| 401 | `unauthorized` | Missing or invalid JWT |
| 403 | `forbidden` | Agent doesn't have permission for this action |
| 404 | `not_found` | Resource (approval, task, agent) not found |
| 409 | `conflict` | Resource locked or memory key conflict |
| 423 | `locked` | Resource is locked by another agent |
| 429 | `rate_limited` | Too many requests from this agent |
| 500 | `internal_error` | Server-side failure |
| 503 | `service_unavailable` | Supabase or Edge Function temporarily down |

---

## 5. Rate Limits

| Endpoint | Limit | Window |
|---|---|---|
| `/submit-approval` | 30 requests | per minute per agent |
| `/heartbeat` | 2 requests | per minute per agent |
| `/query-memory` | 60 requests | per minute per agent |
| `/write-memory` | 20 requests | per minute per agent |
| `/get-queue` | 30 requests | per minute |
| `/batch-decide` | 10 requests | per minute |
| All other endpoints | 60 requests | per minute per agent |

---

## 6. Realtime Event Schemas

### 6.1 Channel: `approval_queue`

**Event: INSERT (new approval)**
```json
{
  "type": "INSERT",
  "table": "approval_queue",
  "record": {
    "id": "uuid",
    "agent_name": "claude-code",
    "title": "Refactor auth middleware",
    "risk_level": "medium",
    "status": "pending",
    "requested_at": "ISO 8601"
  }
}
```

**Event: UPDATE (decision made)**
```json
{
  "type": "UPDATE",
  "table": "approval_queue",
  "old_record": { "status": "pending" },
  "record": {
    "id": "uuid",
    "status": "approved",
    "decided_at": "ISO 8601",
    "decision_note": "Looks good, proceed"
  }
}
```

### 6.2 Channel: `tasks`

**Event: UPDATE (task status change)**
```json
{
  "type": "UPDATE",
  "table": "tasks",
  "record": {
    "id": "uuid",
    "status": "in_progress",
    "assigned_surface": "uuid"
  }
}
```

---

## 7. Authentication Flow

### 7.1 Agent Authentication

1. Agent calls `/register-agent` with master service key (one-time setup)
2. Receives a scoped API key unique to that agent
3. All subsequent calls use the scoped key as Bearer token
4. Key can be rotated via the mobile dashboard

### 7.2 Mobile User Authentication

1. User authenticates via Supabase Auth (email/password or magic link)
2. JWT issued with `user_id` claim
3. RLS policies ensure user only sees their own surfaces and approvals
4. JWT refresh handled by Supabase client library

### 7.3 Scoped Permissions

| Agent Action | Permission |
|---|---|
| Submit approval | Own surface only |
| Decide on approval | User only (no agent self-approval) |
| Read memory | All domains |
| Write memory | Own surface's entries only |
| Lock resource | Any unlocked resource |
| Unlock resource | Own locks only |
