# CLAUDE.md — Unified Control Plane Specification

**Version:** 1.0
**Author:** Johnwil
**Date:** 2026-03-10
**Status:** Draft → Implementation Ready

---

## 1. Vision

A single, mobile-first approval surface that governs all parallel AI-assisted work happening across six or more execution surfaces — Claude Cowork (desktop), Claude Code (terminal), OpenAI Codex, ChatGPT, Antigravity IDE, and in-app Excel — while maintaining a durable, queryable system of records in Supabase.

**Core principle:** _Work happens everywhere. Decisions happen in one place. Memory lives forever._

---

## 2. System Identity

| Property | Value |
|---|---|
| System Name | **Parallel Operations Control Plane (POCP)** |
| Approval Surface | Mobile-first PWA / native app |
| Memory Layer | Supabase (Postgres + Realtime + Edge Functions) |
| Agent Protocol | Event-driven, queue-based |
| Auth Model | Supabase Auth with row-level security |

---

## 3. Problem Statement

Running parallel AI operations across multiple surfaces creates three critical gaps:

**Fragmented Approvals** — Each surface has its own permission model. Approving a Claude Code commit is disconnected from approving a Cowork file edit or a Codex PR. Context-switching between surfaces to approve work creates bottlenecks and risks approving work without full context.

**No Shared Memory** — What Claude Code learns about a codebase is invisible to Cowork. A decision made in ChatGPT doesn't persist anywhere queryable. Institutional knowledge is scattered across ephemeral chat sessions.

**No Orchestration** — Six terminals can run in parallel, but nothing coordinates them. Two agents might solve the same problem differently, or one agent's output might contradict another's. There is no sequencing, deduplication, or conflict resolution.

---

## 4. Architecture

### 4.1 Three-Layer Design

```
┌──────────────────────────────────────────────────┐
│           LAYER 1: APPROVAL SURFACE              │
│         (Mobile-First PWA / Native App)          │
│                                                  │
│  ┌─────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Queue   │ │ Diff     │ │ One-Tap          │  │
│  │ Feed    │ │ Viewer   │ │ Approve/Reject   │  │
│  └─────────┘ └──────────┘ └──────────────────┘  │
└──────────────────┬───────────────────────────────┘
                   │ Supabase Realtime
┌──────────────────▼───────────────────────────────┐
│           LAYER 2: ORCHESTRATION                 │
│         (Supabase Edge Functions)                │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │ Task     │ │ Conflict │ │ Memory         │   │
│  │ Router   │ │ Resolver │ │ Consolidator   │   │
│  └──────────┘ └──────────┘ └────────────────┘   │
└──────────────────┬───────────────────────────────┘
                   │ Postgres + Queue
┌──────────────────▼───────────────────────────────┐
│           LAYER 3: EXECUTION SURFACES            │
│                                                  │
│  ┌────────┐ ┌────────┐ ┌───────┐ ┌───────────┐  │
│  │Cowork  │ │Claude  │ │Codex  │ │Antigravity│  │
│  │Desktop │ │Code    │ │       │ │IDE        │  │
│  └────────┘ └────────┘ └───────┘ └───────────┘  │
│  ┌────────┐ ┌────────┐                           │
│  │ChatGPT │ │Excel   │                           │
│  │        │ │Claude  │                           │
│  └────────┘ └────────┘                           │
└──────────────────────────────────────────────────┘
```

### 4.2 Data Flow

1. **Agent generates work** → Posts an Approval Request to Supabase (`approval_queue` table)
2. **Supabase Realtime** → Pushes the request to the mobile approval surface instantly
3. **User reviews on phone** → Sees context, diff, risk level, and agent source
4. **User taps Approve / Reject / Modify** → Decision writes back to Supabase
5. **Originating agent picks up decision** → Executes, revises, or halts
6. **Outcome logged** → `execution_log` table captures what happened post-approval

---

## 5. Supabase Schema (System of Records)

### 5.1 Core Tables

```sql
-- Surfaces registered in the system
CREATE TABLE surfaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,               -- 'claude-code', 'cowork', 'codex', etc.
  type TEXT NOT NULL,               -- 'terminal', 'desktop', 'browser', 'mobile', 'ide'
  status TEXT DEFAULT 'active',
  last_heartbeat TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

-- The central approval queue
CREATE TABLE approval_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surface_id UUID REFERENCES surfaces(id),
  agent_name TEXT NOT NULL,         -- 'claude-code', 'chatgpt', 'codex'
  task_id UUID,                     -- links to the task this approval belongs to
  title TEXT NOT NULL,              -- short human-readable summary
  description TEXT,                 -- detailed context
  diff_payload JSONB,              -- code diffs, file changes, structured output
  risk_level TEXT DEFAULT 'low',   -- 'low', 'medium', 'high', 'critical'
  status TEXT DEFAULT 'pending',   -- 'pending', 'approved', 'rejected', 'modified'
  decision_note TEXT,              -- user's note on why approved/rejected
  requested_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ           -- auto-reject after expiry
);

-- Durable memory — what agents know
CREATE TABLE memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surface_id UUID REFERENCES surfaces(id),
  domain TEXT NOT NULL,             -- 'codebase', 'project', 'decision', 'context'
  key TEXT NOT NULL,                -- namespaced key like 'project:api:auth-strategy'
  value JSONB NOT NULL,
  confidence FLOAT DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT                   -- which agent wrote this
);

-- Execution log — what actually happened
CREATE TABLE execution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id UUID REFERENCES approval_queue(id),
  surface_id UUID REFERENCES surfaces(id),
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,            -- 'success', 'failure', 'partial'
  output JSONB,
  executed_at TIMESTAMPTZ DEFAULT now(),
  duration_ms INT
);

-- Task registry — master list of work items
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',    -- 'pending', 'assigned', 'in_progress', 'blocked', 'done'
  assigned_surface UUID REFERENCES surfaces(id),
  priority INT DEFAULT 3,           -- 1 = critical, 5 = backlog
  parent_task_id UUID REFERENCES tasks(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);
```

### 5.2 Row-Level Security

```sql
-- All tables restricted to authenticated user
ALTER TABLE approval_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_owns_approvals" ON approval_queue
  FOR ALL USING (auth.uid() = (SELECT owner_id FROM surfaces WHERE id = surface_id));
```

### 5.3 Realtime Subscriptions

The mobile approval surface subscribes to:
- `approval_queue` INSERT events (new approvals arrive)
- `approval_queue` UPDATE events (status changes)
- `tasks` UPDATE events (progress tracking)

---

## 6. Approval Process Specification

### 6.1 Approval Request Schema

Every agent, regardless of surface, submits approvals in this format:

```json
{
  "agent_name": "claude-code",
  "title": "Refactor auth middleware to use JWT",
  "description": "Replaced session-based auth with JWT tokens across 4 files",
  "risk_level": "medium",
  "diff_payload": {
    "files_changed": 4,
    "insertions": 87,
    "deletions": 42,
    "preview": "--- a/middleware/auth.js\n+++ b/middleware/auth.js\n..."
  },
  "requires_approval_before": "commit",
  "expires_at": "2026-03-10T18:00:00Z"
}
```

### 6.2 Risk Classification

| Level | Criteria | Auto-Approve Eligible |
|---|---|---|
| **Low** | Read-only, formatting, comments | Yes (configurable) |
| **Medium** | Code changes, file modifications | No |
| **High** | Deployments, schema changes, API changes | No |
| **Critical** | Destructive ops, production changes, financial | No, requires confirmation |

### 6.3 Approval Flow

```
Agent Work Complete
       │
       ▼
 Risk Assessment
       │
  ┌────┴────┐
  │ Low     │ Medium/High/Critical
  │         │
  ▼         ▼
Auto-     Push to
Approve?  Mobile Queue
  │         │
  │         ▼
  │    User Reviews
  │    on Phone
  │         │
  │    ┌────┴────┐
  │    │         │
  │  Approve  Reject/Modify
  │    │         │
  │    ▼         ▼
  │  Execute   Return to Agent
  │    │       with Feedback
  │    │         │
  └────┴─────────┘
       │
       ▼
  Log to execution_log
  Update memory table
```

### 6.4 Mobile Approval UI Requirements

The mobile surface presents each approval as a card:

- **Header:** Agent name + surface icon + timestamp
- **Title:** One-line summary of what the agent did
- **Risk badge:** Color-coded (green/yellow/orange/red)
- **Expandable diff:** Tap to see full changes
- **Context panel:** Related memory entries and prior approvals
- **Actions:** Approve (green) / Reject (red) / Modify (blue, opens text input)
- **Batch mode:** Select multiple low-risk items and approve all

---

## 7. Memory Consolidation Protocol

### 7.1 How Agents Write Memory

Each agent, after completing approved work, writes a memory entry:

```json
{
  "domain": "codebase",
  "key": "api:auth:strategy",
  "value": {
    "approach": "JWT with refresh tokens",
    "decided_on": "2026-03-10",
    "decided_by": "claude-code",
    "rationale": "Stateless auth for microservice architecture",
    "files_affected": ["middleware/auth.js", "config/jwt.js"]
  },
  "confidence": 0.95
}
```

### 7.2 Memory Conflict Resolution

When two agents write to the same key:
1. Higher confidence wins
2. If equal confidence, most recent wins
3. Conflict is flagged in `approval_queue` for user review
4. User's decision becomes the canonical memory entry

### 7.3 Memory Querying

Any agent can read from the memory table before starting work:

```sql
SELECT key, value, confidence, created_by
FROM memory
WHERE domain = 'codebase'
  AND key LIKE 'api:auth:%'
ORDER BY confidence DESC, updated_at DESC
LIMIT 5;
```

This prevents agents from contradicting established decisions.

---

## 8. Development Phases

### Phase 1: Foundation (Weeks 1–2)

- Deploy Supabase schema (tables, RLS, indexes)
- Build Edge Function for approval ingestion (`POST /approve`)
- Build Edge Function for decision relay (`POST /decide`)
- Create Supabase Realtime channel for `approval_queue`
- Stand up a minimal mobile PWA (React/Next.js) that displays the approval queue

**Deliverable:** A working queue where you can manually insert approvals and approve them from your phone.

### Phase 2: Agent Connectors (Weeks 3–5)

- **Claude Code connector:** Hook into pre-commit / post-task to auto-submit approvals
- **Cowork connector:** Use CLAUDE.md / hooks to submit file changes for approval
- **Codex connector:** GitHub webhook that captures Codex PRs and routes to approval queue
- **ChatGPT connector:** Browser extension or copy-paste bridge that captures ChatGPT outputs
- **Antigravity connector:** IDE plugin or CLI wrapper that submits from the IDE
- **Excel connector:** VBA macro or Office Script that posts structured changes

**Deliverable:** All six surfaces can submit approval requests to Supabase.

### Phase 3: Memory Layer (Weeks 6–7)

- Implement memory write protocol in each connector
- Build memory query API (Edge Function)
- Add memory context panel to mobile approval UI
- Implement conflict detection and resolution flow

**Deliverable:** Agents read shared memory before starting work and write memory after completing it.

### Phase 4: Orchestration (Weeks 8–10)

- Build Task Router (assigns incoming tasks to best available surface)
- Build Conflict Resolver (detects when two agents work on the same thing)
- Add task dependency graph (Task A must complete before Task B starts)
- Implement parallel execution dashboard on mobile

**Deliverable:** You can dispatch a task and the system routes it to the right agent, avoids conflicts, and respects dependencies.

### Phase 5: Intelligence (Weeks 11–12)

- Auto-risk classification using LLM analysis of diffs
- Smart batching (group related low-risk approvals)
- Approval pattern learning (suggest auto-approve rules based on history)
- Weekly digest: summarize all agent activity, decisions, and memory changes

**Deliverable:** The system gets smarter over time and reduces approval friction.

---

## 9. Scalability Design

### 9.1 Horizontal Scaling

- **Surfaces:** Adding a new surface means writing one connector that implements the Approval Request Schema. No changes to the core system.
- **Agents:** Each agent is stateless. The queue is the coordination mechanism. Add more agents without coordination overhead.
- **Memory:** Supabase Postgres scales vertically. For extreme scale, shard by domain.

### 9.2 Latency Targets

| Path | Target |
|---|---|
| Agent → Queue | < 500ms |
| Queue → Mobile Push | < 1s (Realtime) |
| Mobile → Decision → Agent | < 2s |

### 9.3 Offline Resilience

- Mobile PWA caches pending approvals offline
- Decisions sync when connectivity returns
- Agents continue non-approval work while waiting
- Expired approvals auto-reject with notification

---

## 10. Security Model

- All API calls authenticated via Supabase Auth (JWT)
- Row-level security ensures user can only see their own data
- Approval decisions are cryptographically signed (user ID + timestamp)
- Sensitive diffs (credentials, secrets) are flagged and redacted in the mobile view
- All memory writes are append-only with full audit trail

---

## 11. Integration with LIFE_OS

This system extends LIFE_OS by adding:
- **AUTOMATION domain:** Tracks all agent activity and approval history
- **BUILDS domain:** Links tasks to specific build projects
- **SYSTEM domain:** Logs system health, connector status, and memory conflicts
- ActiveFocus.md can be auto-updated based on active tasks in the task registry

---

## 12. Success Metrics

| Metric | Target |
|---|---|
| Approval response time | < 30 seconds median |
| Memory conflict rate | < 5% of writes |
| Agent utilization (non-idle time) | > 80% |
| Approval queue depth | < 10 pending at any time |
| Cross-agent contradiction rate | < 2% |
