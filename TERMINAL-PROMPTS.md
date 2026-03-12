# 9 Terminal Prompts — Parallel Development Plan

**System:** Parallel Operations Control Plane (POCP)
**Date:** 2026-03-10
**Usage:** Copy each prompt into a separate terminal (Claude Code, Codex, Cowork, etc.)

---

## Terminal 1: Firebase Setup & Security Rules

**Reference Document:** `CLAUDE.md` — Section 5 (Firebase Schema)

```
You are building the Parallel Operations Control Plane (POCP).

YOUR TASK: Deploy the complete Firebase/Firestore setup.

REFERENCE DOCUMENT: Read CLAUDE.md, Section 5 "Firestore Schema (System of Records)" — this is your single source of truth.

Implement the following:
1. Create all 5 core Firestore collections exactly as specified in §5.1: surfaces, approval_queue, memory, execution_log, tasks
2. Add a locks collection for file-level locking (referenced in Agent.md §5.1)
3. Enable Firestore Security Rules on ALL collections per §5.2
4. Add an ownerId field to the surfaces collection (referenced by the security rules)
5. Create composite indexes in firestore.indexes.json for: approval_queue(status, requested_at), memory(domain, key), tasks(status, priority), locks(resource_path)
6. Configure Firestore realtime listeners on approval_queue and tasks collections per §5.3
7. Seed the surfaces collection with the 6 agents defined in Agent.md §2.1: cowork-desktop, claude-code, openai-codex, chatgpt, antigravity-ide, excel-claude

Use Firebase CLI for deployment. Do NOT hardcode UUIDs. Test each collection with a sample document write/read.
```

---

## Terminal 2: Cloud Functions — Approval Flow

**Reference Document:** `AIHubCommander Center/API-Spec.md` — Sections 3.1, 3.2, 3.13

```
You are building the Parallel Operations Control Plane (POCP).

YOUR TASK: Build the approval-related Cloud Functions.

REFERENCE DOCUMENT: Read AIHubCommander Center/API-Spec.md — Sections 3.1, 3.2, and 3.13 are your single source of truth for request/response schemas.

Implement these 3 Cloud Functions:

1. POST /submit-approval (§3.1)
   - Validate all required fields (agent_name, title, risk_level)
   - Resolve surface_id from agent_name if not provided
   - Check for resource locks on files in diff_payload.metadata.file_paths
   - Set default expires_at to 1 hour from now
   - Return 201 with approval_id, status, queue_position
   - Return 409 if any file is locked

2. POST /decide (§3.2)
   - Accept approval_id + decision (approved/rejected/modified)
   - Update approval_queue.status and decided_at
   - If modified, store modifications JSON
   - Firestore update triggers onSnapshot listeners automatically
   - Return 200 with agent_notified status

3. POST /batch-decide (§3.13)
   - Accept array of decisions
   - Process each in a transaction
   - Return processed count and individual results

All functions must: validate JWT auth, handle errors per §4 error codes, respect rate limits per §5.
Use Node.js runtime, use firebase-functions/v2
```

---

## Terminal 3: Cloud Functions — Agent Lifecycle

**Reference Document:** `AIHubCommander Center/API-Spec.md` — Sections 3.3, 3.4, 3.12

```
You are building the Parallel Operations Control Plane (POCP).

YOUR TASK: Build the agent lifecycle Cloud Functions.

REFERENCE DOCUMENT: Read AIHubCommander Center/API-Spec.md — Sections 3.3, 3.4, and 3.12 are your single source of truth.

Implement these 3 Cloud Functions:

1. POST /register-agent (§3.3)
   - Accept name, type, capabilities, metadata
   - Insert into surfaces collection
   - Return 201 with surface_id and a scoped API key
   - Return 409 if agent name already exists

2. POST /heartbeat (§3.4)
   - Accept surface_id, status, current_tasks, load metrics
   - Update surfaces.last_heartbeat and surfaces.status
   - Return any pending task assignments from the tasks collection
   - Return any pending approval decisions for this agent
   - This doubles as a polling fallback if Realtime is down

3. GET /get-dashboard (§3.12)
   - Return all registered agents with status, current task, last heartbeat, tasks completed today
   - Return queue metrics: pending count, approved/rejected today, avg response time
   - Return memory metrics: total entries, conflicts today, active domains
   - Return task metrics: in progress, completed today, blocked, avg completion time
   - Mark agents as 'inactive' if last_heartbeat > 3 minutes ago

All functions must: validate JWT auth, handle errors per §4, respect rate limits per §5.
Use Node.js runtime, use firebase-functions/v2
```

---

## Terminal 4: Cloud Functions — Memory & Tasks

**Reference Document:** `AIHubCommander Center/API-Spec.md` — Sections 3.5, 3.6, 3.7, 3.8

```
You are building the Parallel Operations Control Plane (POCP).

YOUR TASK: Build the memory and task management Cloud Functions.

REFERENCE DOCUMENT: Read AIHubCommander Center/API-Spec.md — Sections 3.5, 3.6, 3.7, and 3.8 are your single source of truth.

Implement these 4 Cloud Functions:

1. POST /query-memory (§3.5)
   - Accept domain, key_pattern (SQL LIKE), limit, min_confidence, created_by filter
   - Query memory collection with filters
   - Return entries array with total_count and has_conflicts flag
   - has_conflicts = true if multiple entries exist for the same key with different values

2. POST /write-memory (§3.6)
   - Accept surface_id, domain, key, value, confidence, source_approval_id
   - Check for existing entry with same domain+key
   - If conflict: higher confidence wins; equal confidence = most recent wins
   - If true conflict (can't auto-resolve), create an approval_queue entry for user review
   - Return 201 with memory_id and conflict_detected flag
   - Return 409 with conflicting entry details if conflict detected

3. POST /assign-task (§3.7)
   - Accept task details + assigned_surface
   - Create new task or update existing
   - Support depends_on array for task dependencies
   - Return 201 with task_id and status

4. POST /complete-task (§3.8)
   - Accept task_id, surface_id, outcome, output, duration_ms, memory_entries
   - Update task status to 'done'
   - Write any included memory_entries
   - Check if completing this task unblocks other tasks (depends_on)
   - Return list of newly unblocked task IDs

All functions must: validate JWT auth, handle errors per §4, respect rate limits per §5.
Use Node.js runtime, use firebase-functions/v2
```

---

## Terminal 5: Cloud Functions — Locking & Conflicts

**Reference Document:** `AIHubCommander Center/API-Spec.md` — Sections 3.9, 3.10, 3.14 + `Agent.md` — Section 5

```
You are building the Parallel Operations Control Plane (POCP).

YOUR TASK: Build the resource locking and conflict management Cloud Functions.

REFERENCE DOCUMENTS:
- Read AIHubCommander Center/API-Spec.md — Sections 3.9, 3.10, 3.14 for endpoint schemas
- Read Agent.md — Section 5 for conflict avoidance and resolution rules

Implement these 3 Cloud Functions:

1. POST /lock-resource (§3.9)
   - Accept surface_id, resource_type (file/table/api_endpoint/domain), resource_path, duration_minutes
   - Check if resource is already locked (and lock hasn't expired)
   - If locked: return 423 with lock details (who, when, expires)
   - If available: create lock with mandatory expiration (max 240 minutes per API-Spec)
   - Return 200 with lock_id, resource_path, locked_by, expires_at

2. POST /unlock-resource (§3.10)
   - Accept lock_id, surface_id
   - Verify the requesting agent owns the lock
   - Delete the lock record
   - Return 200 with unlocked: true

3. POST /conflict-report (§3.14)
   - Accept reporting_agent, conflict_type (file_collision/semantic_contradiction/duplicate_task), resource, other_agent, details, suggested_resolution
   - Create an approval_queue entry for user to resolve the conflict
   - Pause both agents' current tasks (update tasks.status = 'blocked')
   - Return 201 with conflict_id, approval_id, both_agents_paused: true

Also implement:
4. A Cloud Scheduler function that runs every 5 minutes to clean up expired locks

All functions must: validate JWT auth, handle errors per §4, respect rate limits per §5.
Use Node.js runtime, use firebase-functions/v2
```

---

## Terminal 6: Mobile PWA — Project Shell & Auth

**Reference Document:** `AIHubCommander Center/Mobile-PWA-Spec.md` — Sections 2, 4, 6, 7, 9, 10, 11

```
You are building the Parallel Operations Control Plane (POCP).

YOUR TASK: Scaffold the mobile-first PWA project shell with authentication and navigation.

REFERENCE DOCUMENT: Read AIHubCommander Center/Mobile-PWA-Spec.md — this is your single source of truth for tech stack, file structure, navigation, and design tokens.

Implement the following:

1. Initialize a Next.js 14 (App Router) project in a 'mobile-pwa/' directory
   - Tech stack per §1: Next.js 14 + Firebase JS SDK + Tailwind CSS + PWA manifest
   - File structure per §11

2. Set up Firebase Authentication (email/password + magic link)
   - Create lib/firebase.ts with client initialization
   - Add auth middleware to protect all routes
   - Create a minimal login/signup page

3. Build the root layout with Bottom Tab Bar per §4.1
   - Three tabs: Queue (with badge count), Agents (with offline dot), Memory (with conflict dot)
   - Fixed at bottom of every screen
   - Create the BottomNav.tsx component

4. Set up all route stubs per §2.1: /, /approval/[id], /batch, /agents, /memory, /tasks, /conflict/[id], /settings

5. Configure PWA manifest per §11:
   - public/manifest.json with app name, icons, theme color
   - public/sw.js service worker stub
   - Offline banner component (OfflineBanner.tsx)

6. Apply design tokens per §9 and §10:
   - All CSS variables in styles/globals.css
   - Dark mode support per §10

7. Set up Firestore onSnapshot hooks in lib/realtime.ts
   - Subscribe to approval_queue INSERT/UPDATE
   - Subscribe to tasks UPDATE

Performance targets per §7: FCP < 1.5s, TTI < 2.5s, app size < 2MB.
```

---

## Terminal 7: Mobile PWA — Queue & Approval UI

**Reference Document:** `AIHubCommander Center/Mobile-PWA-Spec.md` — Sections 3.1, 3.2, 3.3, 5

```
You are building the Parallel Operations Control Plane (POCP).

YOUR TASK: Build the approval queue feed and card detail UI components for the mobile PWA.

REFERENCE DOCUMENT: Read AIHubCommander Center/Mobile-PWA-Spec.md — Sections 3.1, 3.2, 3.3, and 5 are your single source of truth.

PREREQUISITE: Terminal 6 must have scaffolded the Next.js project in mobile-pwa/.

Implement the following components in mobile-pwa/components/:

1. ApprovalCard.tsx (§3.1)
   - Render as a card in the queue feed with: agent icon, agent name, timestamp, title, risk badge, change summary, action buttons
   - Interactions: tap body → Card Detail, tap Approve → haptic + slide left, tap Reject → text input + slide right, tap Modify → text input
   - Swipe right = quick approve, swipe left = quick reject
   - Long press = add to batch selection

2. RiskBadge.tsx (§3.2)
   - Pill-shaped badge with color coding: Low (#10B981), Medium (#F59E0B), High (#F97316), Critical (#EF4444)
   - White text on colored background

3. Card Detail View — app/approval/[id]/page.tsx (§3.3)
   - Full-screen modal sliding up from bottom
   - Sections: Header (agent info, timestamps, risk), Description, Diff viewer (syntax-highlighted, collapsible per file), Context panel (related memory + prior approvals), sticky Action bar
   - Build DiffViewer.tsx component for syntax-highlighted code diffs

4. Batch Select Mode — app/batch/page.tsx
   - Multi-select low-risk items with checkboxes
   - "Approve All Selected" button
   - Calls /batch-decide endpoint

5. Queue page — app/page.tsx
   - Scrollable feed of ApprovalCard components
   - Fetch from /get-queue endpoint
   - Live updates via Firestore onSnapshot listener
   - Pull-to-refresh per §4.2

6. Push notification setup in lib/notifications.ts per §5
   - Register service worker for push
   - Handle notification click deep links
```

---

## Terminal 8: Mobile PWA — Dashboard, Memory & Tasks

**Reference Document:** `AIHubCommander Center/Mobile-PWA-Spec.md` — Sections 3.4, 3.5, 3.6, 3.7

```
You are building the Parallel Operations Control Plane (POCP).

YOUR TASK: Build the Agent Dashboard, Memory Explorer, Task Board, and Conflict Resolver screens.

REFERENCE DOCUMENT: Read AIHubCommander Center/Mobile-PWA-Spec.md — Sections 3.4, 3.5, 3.6, and 3.7 are your single source of truth.

PREREQUISITE: Terminal 6 must have scaffolded the Next.js project in mobile-pwa/.

Implement:

1. Agent Dashboard — app/agents/page.tsx + AgentCard.tsx (§3.4)
   - 2-column grid of agent status cards
   - Each card shows: status ring (green/yellow/red/gray), agent name, current task, tasks completed today, last heartbeat time
   - Bottom metrics bar: pending count, approved today, avg response time
   - Fetch from /get-dashboard endpoint
   - Auto-refresh via Realtime or 30s polling

2. Memory Explorer — app/memory/page.tsx + MemoryEntry.tsx (§3.5)
   - Search bar at top
   - Domain filter tabs: codebase, project, decision, all
   - Each entry shows: key, value summary, created_by agent, confidence score, timestamp
   - Conflict entries highlighted with warning icon and "Tap to resolve" CTA
   - Fetch from /query-memory endpoint

3. Task Board — app/tasks/page.tsx + TaskColumn.tsx (§3.6)
   - Horizontal scrolling Kanban board
   - Columns: Pending, In Progress, Blocked, Done
   - Each task card shows: title, assigned agent, priority indicator
   - Tap card to see full task details

4. Conflict Resolver — app/conflict/[id]/page.tsx + ConflictCompare.tsx (§3.7)
   - Side-by-side comparison of two conflicting entries
   - Show: agent name, value, confidence, timestamp for each side
   - Actions: Pick Left, Pick Right, Custom (opens text input)
   - On resolution, calls /write-memory with the winning value

5. Settings — app/settings/page.tsx
   - Auto-approve toggle for low-risk items
   - Notification preferences
   - Agent configuration (pause/resume)
```

---

## Terminal 9: Connector SDK & Claude Code Connector

**Reference Document:** `AIHubCommander Center/Connector-Specs.md` — Sections 2 and 3

```
You are building the Parallel Operations Control Plane (POCP).

YOUR TASK: Build the shared Connector SDK and the Claude Code connector as the first implementation.

REFERENCE DOCUMENT: Read AIHubCommander Center/Connector-Specs.md — Section 2 (Shared SDK) and Section 3 (Claude Code Connector) are your single source of truth.

Implement:

1. Shared Connector SDK (§2) in a 'pocp-connector-sdk/' directory
   - File structure per §2.1: src/index.ts, client.ts, approval.ts, memory.ts, heartbeat.ts, lock.ts, task.ts, types.ts
   - TypeScript interfaces per §2.2: ApprovalRequest, DiffPayload, ApprovalDecision, MemoryEntry, HeartbeatPayload, ConnectorConfig
   - POCPClient class per §2.3 with methods:
     - submitApproval() — post to /submit-approval
     - waitForDecision() — listen via Realtime for approval status change
     - queryMemory() / writeMemory() — read/write shared memory
     - startHeartbeat() / stopHeartbeat() — 60s interval pings
     - lockResource() / unlockResource() — file-level locking
     - completeTask() — report task completion
     - disconnect() — cleanup
   - Package as an npm module with proper exports

2. Claude Code Connector (§3) in a '.claude/pocp/' directory
   - config.json template for Firebase project config, API key, surface ID
   - connector.ts — CLI wrapper around POCPClient (commands: query-memory, submit-approval, wait-decision, assess-risk)
   - risk-assessor.ts per §3.5 — classify diffs as low/medium/high/critical based on patterns
   - diff-builder.ts — construct diff_payload from git state (git diff --staged)

3. Hook scripts in '.claude/hooks/'
   - pre-task.sh per §3.3 — query memory for project context before each task
   - post-task.sh per §3.4 — build diff, assess risk, submit approval, wait for decision, act on result
   - heartbeat.sh — background heartbeat ping

4. Write tests per Connector-Specs.md §9.1 test matrix:
   - Submit approval, receive decision, memory read/write, heartbeat, lock acquire/conflict/release, risk assessment
```

---

## Quick Reference: Document → Terminal Mapping

| Terminal | Workstream | Primary Document |
|---|---|---|
| T1 | Firestore Schema & Security Rules | `CLAUDE.md` §5 |
| T2 | Cloud Functions: Approvals | `API-Spec.md` §3.1, §3.2, §3.13 |
| T3 | Cloud Functions: Agent Lifecycle | `API-Spec.md` §3.3, §3.4, §3.12 |
| T4 | Cloud Functions: Memory & Tasks | `API-Spec.md` §3.5–§3.8 |
| T5 | Cloud Functions: Locking & Conflicts | `API-Spec.md` §3.9, §3.10, §3.14 + `Agent.md` §5 |
| T6 | Mobile PWA: Shell & Auth | `Mobile-PWA-Spec.md` §2, §4, §9–§11 |
| T7 | Mobile PWA: Queue & Approval UI | `Mobile-PWA-Spec.md` §3.1–§3.3, §5 |
| T8 | Mobile PWA: Dashboard & Memory | `Mobile-PWA-Spec.md` §3.4–§3.7 |
| T9 | Connector SDK + Claude Code | `Connector-Specs.md` §2, §3 |

## Dependency Order

```
T1 (Schema) ──► T2, T3, T4, T5 (Cloud Functions — all need collections)
T6 (PWA Shell) ──► T7, T8 (PWA Components — need project scaffold)
T9 (SDK) ──► No blockers (independent)

Recommended launch order:
  Wave 1 (immediate): T1, T6, T9
  Wave 2 (after T1 done): T2, T3, T4, T5
  Wave 3 (after T6 done): T7, T8
```
