# API-Spec.md — Cloud Functions for Firebase & Endpoint Specification

**Version:** 2.0
**Author:** Johnwil
**Date:** 2026-03-10
**Platform:** Firebase / Google Cloud
**Parent Document:** [Claude.md](./Claude.md)

---

## 1. Overview

All agent-to-system communication flows through Cloud Functions for Firebase deployed as Node.js-based Cloud Functions (2nd gen). This document defines every endpoint, its request/response schema, authentication requirements, error handling, and rate limits.

**Base URL:** `https://<region>-<project-id>.cloudfunctions.net`

**Auth:** User-surface endpoints require a valid Firebase Auth ID token in the `Authorization: Bearer <token>` header unless marked as public. Provider callbacks, such as GitHub webhooks, use dedicated public ingress secured with provider-specific signature verification.

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
| 15 | `/webhooks/github/codex` | POST | Public ingress for Codex PR events from GitHub | No |

---

## 3. Endpoint Specifications

### 3.1 POST `/submit-approval`

Agents call this when they have work that needs approval before execution.

**Request:**

```json
{
  "agentName": "string (required)",
  "surfaceId": "uuid (optional, resolved from agentName if omitted)",
  "taskId": "uuid (optional, links to parent task)",
  "title": "string (required, max 200 chars)",
  "description": "string (optional, max 5000 chars)",
  "diffPayload": {
    "type": "string (code_diff | file_change | data_change | document | other)",
    "filesChanged": "integer",
    "insertions": "integer",
    "deletions": "integer",
    "preview": "string (first 500 lines of diff)",
    "fullDiffUrl": "string (optional, link to full diff)",
    "structuredData": "object (optional, for non-code changes)"
  },
  "riskLevel": "string (low | medium | high | critical)",
  "requiresApprovalBefore": "string (commit | deploy | execute | publish)",
  "expiresAt": "ISO 8601 timestamp (optional, default: 1 hour from now)",
  "metadata": {
    "branch": "string (optional)",
    "repo": "string (optional)",
    "filePaths": ["string array (optional)"],
    "tags": ["string array (optional)"]
  }
}
```

**Response (201 Created):**

```json
{
  "approvalId": "uuid",
  "status": "pending",
  "queuePosition": 3,
  "estimatedReviewTime": "30s",
  "createdAt": "ISO 8601 timestamp"
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
  "lockedBy": "claude-code",
  "lockExpiresAt": "ISO 8601 timestamp"
}
```

---

### 3.2 POST `/decide`

User submits a decision on a pending approval. Called from the mobile PWA.

**Request:**

```json
{
  "approvalId": "uuid (required)",
  "decision": "string (approved | rejected | modified)",
  "decisionNote": "string (optional, max 2000 chars)",
  "modifications": {
    "revisedDiff": "object (optional, if user modified the work)",
    "instructions": "string (optional, text instructions back to agent)"
  }
}
```

**Response (200 OK):**

```json
{
  "approvalId": "uuid",
  "status": "approved",
  "decidedAt": "ISO 8601 timestamp",
  "agentNotified": true
}
```

**Side Effects:**
- Updates `approval_queue` document status and `decided_at` in Firestore
- Triggers Firestore Realtime Listener on `approval_queue` collection for subscribed agents
- If `modified`, creates a follow-up document in `approval_queue` collection for the revision

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
  "surfaceId": "uuid",
  "name": "antigravity-ide",
  "createdAt": "ISO 8601 timestamp"
}
```

**Response (409 Conflict):**

```json
{
  "error": "agent_exists",
  "message": "An agent named 'antigravity-ide' is already registered",
  "existingSurfaceId": "uuid"
}
```

---

### 3.4 POST `/heartbeat`

Agents ping every 60 seconds to signal availability.

**Request:**

```json
{
  "surfaceId": "uuid (required)",
  "status": "string (active | busy | idle)",
  "currentTasks": ["uuid array (task IDs currently being worked on)"],
  "load": {
    "cpuPercent": "number (optional)",
    "memoryPercent": "number (optional)",
    "queueDepth": "integer (optional)"
  }
}
```

**Response (200 OK):**

```json
{
  "acknowledged": true,
  "pendingAssignments": [
    {
      "taskId": "uuid",
      "title": "string",
      "priority": 2
    }
  ],
  "pendingDecisions": [
    {
      "approvalId": "uuid",
      "decision": "approved",
      "instructions": "string or null"
    }
  ]
}
```

The heartbeat response doubles as a polling fallback — if Firestore Realtime Listeners are unavailable, agents still get assignments and decisions through heartbeat responses.

---

### 3.5 POST `/query-memory`

Agent reads from the shared memory collection before starting work.

**Request:**

```json
{
  "domain": "string (required: codebase | project | decision | context)",
  "keyPattern": "string (required, supports prefix matching: 'api:auth:')",
  "limit": "integer (optional, default: 10, max: 50)",
  "minConfidence": "float (optional, default: 0.5)",
  "createdBy": "string (optional, filter by agent)"
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
      "createdBy": "claude-code",
      "updatedAt": "ISO 8601 timestamp"
    }
  ],
  "totalCount": 3,
  "hasConflicts": false
}
```

---

### 3.6 POST `/write-memory`

Agent contributes knowledge to shared memory after completing approved work.

**Request:**

```json
{
  "surfaceId": "uuid (required)",
  "domain": "string (required)",
  "key": "string (required, namespaced like 'project:api:auth-strategy')",
  "value": "object (required)",
  "confidence": "float (optional, default: 1.0, range: 0.0–1.0)",
  "sourceApprovalId": "uuid (optional, links to the approval that generated this knowledge)"
}
```

**Response (201 Created):**

```json
{
  "memoryId": "uuid",
  "conflictDetected": false,
  "createdAt": "ISO 8601 timestamp"
}
```

**Response (409 Conflict):**

```json
{
  "memoryId": "uuid",
  "conflictDetected": true,
  "conflictingEntry": {
    "id": "uuid",
    "key": "project:api:auth-strategy",
    "value": { "approach": "session-based auth" },
    "createdBy": "chatgpt",
    "confidence": 0.8
  },
  "resolution": "queued_for_review",
  "approvalId": "uuid (approval created for user to resolve conflict)"
}
```

---

### 3.7 POST `/assign-task`

Orchestrator (or user via mobile) assigns a task to a specific agent.

**Request:**

```json
{
  "taskId": "uuid (optional, creates new task if omitted)",
  "title": "string (required if new task)",
  "description": "string (optional)",
  "assignedSurface": "uuid (required)",
  "priority": "integer (1–5, default: 3)",
  "parentTaskId": "uuid (optional, for subtasks)",
  "dependsOn": ["uuid array (optional, task IDs that must complete first)"],
  "metadata": {
    "estimatedDurationMin": "integer (optional)",
    "tags": ["string array (optional)"]
  }
}
```

**Response (201 Created):**

```json
{
  "taskId": "uuid",
  "status": "assigned",
  "assignedTo": "antigravity-ide",
  "createdAt": "ISO 8601 timestamp"
}
```

---

### 3.8 POST `/complete-task`

Agent reports that a task is done.

**Request:**

```json
{
  "taskId": "uuid (required)",
  "surfaceId": "uuid (required)",
  "outcome": "string (success | failure | partial)",
  "output": {
    "summary": "string",
    "filesCreated": ["string array"],
    "filesModified": ["string array"],
    "artifacts": "object (optional, any structured output)"
  },
  "durationMs": "integer",
  "memoryEntries": [
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
  "taskId": "uuid",
  "status": "done",
  "memoryEntriesWritten": 2,
  "nextTasksUnblocked": ["uuid array"],
  "completedAt": "ISO 8601 timestamp"
}
```

---

### 3.9 POST `/lock-resource`

Agent requests exclusive access to a file or resource.

**Request:**

```json
{
  "surfaceId": "uuid (required)",
  "resourceType": "string (file | table | api_endpoint | domain)",
  "resourcePath": "string (required, e.g., 'src/middleware/auth.js')",
  "durationMinutes": "integer (optional, default: 60, max: 240)"
}
```

**Response (200 OK):**

```json
{
  "lockId": "uuid",
  "resourcePath": "src/middleware/auth.js",
  "lockedBy": "claude-code",
  "expiresAt": "ISO 8601 timestamp"
}
```

**Response (423 Locked):**

```json
{
  "error": "already_locked",
  "lockedBy": "openai-codex",
  "lockedAt": "ISO 8601 timestamp",
  "expiresAt": "ISO 8601 timestamp"
}
```

---

### 3.10 POST `/unlock-resource`

Agent releases a lock after finishing work.

**Request:**

```json
{
  "lockId": "uuid (required)",
  "surfaceId": "uuid (required)"
}
```

**Response (200 OK):**

```json
{
  "unlocked": true,
  "resourcePath": "src/middleware/auth.js"
}
```

---

### 3.11 GET `/get-queue`

Mobile app fetches the current approval queue.

**Query Parameters:**
- `status` — filter by status (pending | approved | rejected | all), default: pending
- `riskLevel` — filter by risk (low | medium | high | critical | all), default: all
- `agentName` — filter by agent, default: all
- `limit` — max items, default: 20, max: 100
- `offset` — pagination offset, default: 0

**Response (200 OK):**

```json
{
  "items": [
    {
      "id": "uuid",
      "agentName": "claude-code",
      "title": "Refactor auth middleware",
      "riskLevel": "medium",
      "status": "pending",
      "requestedAt": "ISO 8601",
      "expiresAt": "ISO 8601",
      "diffSummary": {
        "filesChanged": 4,
        "insertions": 87,
        "deletions": 42
      }
    }
  ],
  "totalCount": 8,
  "pendingCount": 3,
  "highRiskCount": 1
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
      "surfaceId": "uuid",
      "name": "claude-code",
      "status": "active",
      "currentTask": "Refactoring auth module",
      "lastHeartbeat": "ISO 8601",
      "tasksCompletedToday": 7
    }
  ],
  "queueMetrics": {
    "pending": 3,
    "approvedToday": 15,
    "rejectedToday": 2,
    "avgResponseTimeSeconds": 22
  },
  "memoryMetrics": {
    "totalEntries": 145,
    "conflictsToday": 1,
    "domainsActive": ["codebase", "project", "decision"]
  },
  "taskMetrics": {
    "inProgress": 4,
    "completedToday": 12,
    "blocked": 1,
    "avgCompletionMinutes": 18
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
      "approvalId": "uuid",
      "decision": "approved",
      "decisionNote": "string (optional)"
    },
    {
      "approvalId": "uuid",
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
    { "approvalId": "uuid", "status": "approved" },
    { "approvalId": "uuid", "status": "approved" }
  ]
}
```

---

### 3.14 POST `/conflict-report`

Agent detects a conflict with another agent's work and escalates.

**Request:**

```json
{
  "reportingAgent": "string (required)",
  "conflictType": "string (file_collision | semantic_contradiction | duplicate_task)",
  "resource": "string (file path, memory key, or task description)",
  "otherAgent": "string (the agent being conflicted with)",
  "details": "string (description of the conflict)",
  "suggestedResolution": "string (optional)"
}
```

**Response (201 Created):**

```json
{
  "conflictId": "uuid",
  "approvalId": "uuid (approval created for user to resolve)",
  "bothAgentsPaused": true
}
```

---

### 3.15 POST `/webhooks/github/codex`

Public ingress for GitHub webhook events generated by Codex PR activity.

**Auth:** No Firebase token. Validate `x-hub-signature-256` using the shared GitHub webhook secret.

**Request:** GitHub pull request webhook payload.

**Behavior:**
- Verifies the GitHub webhook signature
- Resolves the matching `openai-codex` surface and `ownerId`
- Writes an `approval_queue` document using the Admin SDK
- Publishes follow-up events for relay/merge handling after decision

---

## 4. Error Codes

| HTTP Code | Error Key | Meaning |
|---|---|---|
| 400 | `validation_error` | Missing or invalid request fields |
| 401 | `unauthorized` | Missing or invalid Firebase Auth ID token |
| 403 | `forbidden` | Agent doesn't have permission for this action |
| 404 | `not_found` | Resource (approval, task, agent) not found |
| 409 | `conflict` | Resource locked or memory key conflict |
| 423 | `locked` | Resource is locked by another agent |
| 429 | `rate_limited` | Too many requests from this agent |
| 500 | `internal_error` | Server-side failure |
| 503 | `service_unavailable` | Firebase or Cloud Function temporarily unavailable |

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

### 6.1 Collection: `approval_queue`

**Event: Document Added (new approval)**

Listener setup using Firestore `onSnapshot`:

```javascript
import { collection, onSnapshot, query, where } from "firebase/firestore";

const q = query(
  collection(db, "approval_queue"),
  where("status", "==", "pending")
);

onSnapshot(q, (snapshot) => {
  snapshot.docChanges().forEach((change) => {
    if (change.type === "added") {
      const doc = change.doc.data();
      // doc shape:
      // {
      //   "id": "uuid",
      //   "agentName": "claude-code",
      //   "title": "Refactor auth middleware",
      //   "riskLevel": "medium",
      //   "status": "pending",
      //   "requestedAt": "ISO 8601"
      // }
    }
  });
});
```

**Event: Document Modified (decision made)**

```javascript
onSnapshot(q, (snapshot) => {
  snapshot.docChanges().forEach((change) => {
    if (change.type === "modified") {
      const doc = change.doc.data();
      // doc shape:
      // {
      //   "id": "uuid",
      //   "status": "approved",
      //   "decidedAt": "ISO 8601",
      //   "decisionNote": "Looks good, proceed"
      // }
    }
  });
});
```

### 6.2 Collection: `tasks`

**Event: Document Modified (task status change)**

```javascript
const tasksQuery = query(
  collection(db, "tasks"),
  where("status", "in", ["assigned", "in_progress", "blocked"])
);

onSnapshot(tasksQuery, (snapshot) => {
  snapshot.docChanges().forEach((change) => {
    if (change.type === "modified") {
      const doc = change.doc.data();
      // doc shape:
      // {
      //   "id": "uuid",
      //   "status": "in_progress",
      //   "assigned_surface": "uuid"
      // }
    }
  });
});
```

---

## 7. Authentication Flow

### 7.1 Agent Authentication

1. Agent authenticates with Firebase Auth (ID token for user surfaces, custom-token exchange for server-managed agents when applicable)
2. Agent calls `/register-agent` to create or resolve its `surfaceId`
3. All subsequent user-surface calls use a Firebase ID token as `Authorization: Bearer <token>`
4. Provider callbacks never use agent tokens; they use public webhook ingress plus signature verification

### 7.2 Mobile User Authentication

1. User authenticates via Firebase Authentication (email/password or custom tokens for agents)
2. Firebase Auth ID token issued with `uid` claim
3. Firestore Security Rules ensure user only sees their own surfaces and approvals
4. Token refresh handled by Firebase client SDK

### 7.3 Scoped Permissions

| Agent Action | Permission |
|---|---|
| Submit approval | Own surface only |
| Decide on approval | User only (no agent self-approval) |
| Read memory | All domains |
| Write memory | Own surface's entries only |
| Lock resource | Any unlocked resource |
| Unlock resource | Own locks only |
