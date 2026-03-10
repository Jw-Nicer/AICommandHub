# AGENT.md — Multi-Agent Orchestration & Parallel Execution Specification

**Version:** 1.0
**Author:** Johnwil
**Date:** 2026-03-10
**Status:** Draft → Implementation Ready
**Companion Document:** [Claude.md](./Claude.md) (Control Plane Spec)

---

## 1. Purpose

This document defines how six or more parallel execution terminals (agents) coordinate, execute, and report work under the Parallel Operations Control Plane (POCP) defined in Claude.md. It covers agent identity, capabilities, communication protocol, the six-terminal execution model, task routing, conflict avoidance, and the implementation plan for building the connectors and orchestration layer.

---

## 2. Agent Registry

Every execution surface is a registered agent with a defined identity, capabilities, and communication interface.

### 2.1 Agent Definitions

| # | Agent ID | Surface | Type | Primary Strengths | Connector Method |
|---|---|---|---|---|---|
| 1 | `cowork-desktop` | Claude Cowork | Desktop app | File creation, document generation, skill execution, browser automation | Native — Supabase JS client in session |
| 2 | `claude-code` | Claude Code | Terminal CLI | Code generation, git ops, testing, debugging, multi-file refactoring | CLI hook — pre/post task webhook |
| 3 | `openai-codex` | OpenAI Codex | Cloud agent | Autonomous PR creation, long-running code tasks, repo-wide changes | GitHub webhook → Edge Function |
| 4 | `chatgpt` | ChatGPT (web/mobile) | Browser/app | Research, analysis, writing, brainstorming, strategy | Browser extension or manual bridge |
| 5 | `antigravity-ide` | Antigravity IDE | Desktop IDE | Live coding, debugging, integrated terminal, project scaffolding | IDE plugin → REST API |
| 6 | `excel-claude` | Excel + Claude | Desktop app | Data analysis, financial modeling, spreadsheet automation | Office Script / VBA → REST API |

### 2.2 Agent Capabilities Matrix

```
                    Code  Files  Data  Research  Deploy  Approve
cowork-desktop       ●      ●     ●      ●        ○       ○
claude-code          ●      ●     ○      ○        ●       ○
openai-codex         ●      ●     ○      ○        ●       ○
chatgpt              ○      ○     ○      ●        ○       ○
antigravity-ide      ●      ●     ○      ○        ○       ○
excel-claude         ○      ●     ●      ○        ○       ○

● = Primary capability   ○ = Not a strength
```

---

## 3. Agent Communication Protocol

### 3.1 Message Format

All agents communicate through Supabase using a standardized message envelope:

```json
{
  "message_id": "uuid-v4",
  "from_agent": "claude-code",
  "to": "orchestrator",
  "type": "approval_request | task_complete | memory_write | heartbeat | conflict_report",
  "payload": { },
  "timestamp": "2026-03-10T14:30:00Z",
  "correlation_id": "task-uuid"
}
```

### 3.2 Message Types

**`approval_request`** — Agent asks for permission to execute something. Routed to mobile approval surface (see Claude.md §6).

**`task_complete`** — Agent reports that assigned work is done. Includes output summary and memory entries.

**`memory_write`** — Agent contributes knowledge to the shared memory layer. Other agents can query this before starting work.

**`heartbeat`** — Every 60 seconds, each active agent pings Supabase. The orchestrator uses this to know which agents are available for task assignment.

**`conflict_report`** — Agent detects it's about to modify something another agent is currently working on. Escalates to orchestrator.

### 3.3 Communication Channels (Supabase Realtime)

```
Channel: agent-bus
  ├── topic: approvals      (approval requests & decisions)
  ├── topic: tasks           (task assignments & completions)
  ├── topic: memory          (memory writes & conflicts)
  └── topic: heartbeats      (agent availability)
```

---

## 4. Six-Terminal Execution Model

### 4.1 Concept

Six terminals run simultaneously. Each terminal hosts one agent. The orchestrator distributes tasks based on agent capability, current load, and task requirements.

```
┌─────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                         │
│              (Supabase Edge Functions)                  │
│                                                         │
│   Task Queue ──► Router ──► Assignment ──► Monitoring   │
└──────┬──────┬──────┬──────┬──────┬──────┬───────────────┘
       │      │      │      │      │      │
       ▼      ▼      ▼      ▼      ▼      ▼
    ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐
    │ T1  ││ T2  ││ T3  ││ T4  ││ T5  ││ T6  │
    │Cowrk││Code ││Codex││Chat ││Anti ││Excel│
    │     ││     ││     ││GPT  ││grav ││     │
    └─────┘└─────┘└─────┘└─────┘└─────┘└─────┘
```

### 4.2 Task Routing Rules

The orchestrator applies these rules in order:

1. **Capability match:** Only assign tasks to agents that have the required capability (see §2.2)
2. **Load balancing:** Prefer the agent with the fewest active tasks
3. **Affinity:** If an agent already has context about a project/file, prefer that agent
4. **Dependency:** If Task B depends on Task A's output, assign Task B to the same agent when possible
5. **User override:** User can manually assign via the mobile approval surface

### 4.3 Parallel Execution Patterns

**Pattern 1: Independent Parallel**
Six unrelated tasks run on six terminals simultaneously. No coordination needed beyond the queue.

```
T1: Build landing page        ──────────────► Done
T2: Write API tests           ──────────────► Done
T3: Refactor database schema  ──────────────► Done
T4: Research competitor APIs  ──────────────► Done
T5: Fix CSS grid issues       ──────────────► Done
T6: Update financial model    ──────────────► Done
```

**Pattern 2: Pipeline Parallel**
Tasks form a pipeline. Output of one feeds into the next, but non-dependent tasks still run in parallel.

```
T4: Research auth strategies ──► T1: Design auth system ──► T2: Implement auth
T5: Design DB schema ─────────────────────────────────────► T3: Implement DB
T6: Update budget with new costs ──────────────────────────────► Done
```

**Pattern 3: Fan-Out / Fan-In**
One task spawns subtasks across multiple agents, then results are consolidated.

```
                    ┌── T1: Frontend changes ──┐
Task: Full feature ─┤── T2: Backend API ───────┤──► T1: Integration test
                    ├── T3: Codex PR review ───┤
                    └── T4: Write docs ────────┘
```

**Pattern 4: Competitive Parallel**
Two agents tackle the same problem independently. User picks the best solution.

```
T2: Solve auth with JWT ──────────────────────┐
                                               ├──► User picks winner
T3: Solve auth with sessions ─────────────────┘
```

---

## 5. Conflict Avoidance & Resolution

### 5.1 File-Level Locking

When an agent begins modifying a file, it registers a lock:

```json
{
  "lock_type": "file",
  "resource": "src/middleware/auth.js",
  "locked_by": "claude-code",
  "locked_at": "2026-03-10T14:30:00Z",
  "expires_at": "2026-03-10T15:30:00Z"
}
```

Other agents check for locks before starting work on the same file. If locked, the task is either queued or routed to a different file.

### 5.2 Semantic Conflict Detection

Beyond file-level locks, the orchestrator checks for semantic conflicts:

- Two agents modifying the same API contract
- One agent deleting a function another agent is extending
- Contradictory architectural decisions in the memory table

Semantic conflicts are escalated to the mobile approval surface with a side-by-side comparison.

### 5.3 Resolution Priority

1. User decision (always highest)
2. Agent with more context (measured by memory entries for that domain)
3. Agent that started first (temporal priority)
4. Orchestrator auto-merge if changes are non-overlapping

---

## 6. Connector Implementation Specifications

### 6.1 Claude Code Connector

**Hook point:** CLAUDE.md hooks (post-task)

```bash
# .claude/hooks/post-task.sh
#!/bin/bash
# After each Claude Code task, submit approval if needed

TASK_OUTPUT=$(cat /tmp/claude-code-last-output.json)
RISK=$(echo $TASK_OUTPUT | jq -r '.risk_level')

if [ "$RISK" != "low" ]; then
  curl -X POST "$SUPABASE_URL/functions/v1/submit-approval" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"agent_name\": \"claude-code\",
      \"title\": $(echo $TASK_OUTPUT | jq '.summary'),
      \"diff_payload\": $(echo $TASK_OUTPUT | jq '.diff'),
      \"risk_level\": \"$RISK\"
    }"
fi
```

### 6.2 Cowork Connector

**Hook point:** Session lifecycle events

Cowork sessions can call Supabase directly using the JS client:

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function submitApproval(task) {
  const { data, error } = await supabase
    .from('approval_queue')
    .insert({
      agent_name: 'cowork-desktop',
      title: task.title,
      description: task.description,
      diff_payload: task.changes,
      risk_level: assessRisk(task)
    });
}
```

### 6.3 OpenAI Codex Connector

**Hook point:** GitHub webhook on PR creation

```javascript
// Supabase Edge Function: handle-codex-pr
Deno.serve(async (req) => {
  const payload = await req.json();

  if (payload.action === 'opened' && payload.pull_request) {
    const pr = payload.pull_request;

    await supabase.from('approval_queue').insert({
      agent_name: 'openai-codex',
      title: `PR: ${pr.title}`,
      description: pr.body,
      diff_payload: {
        url: pr.diff_url,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files
      },
      risk_level: pr.changed_files > 10 ? 'high' : 'medium'
    });
  }

  return new Response('ok');
});
```

### 6.4 ChatGPT Connector (Bridge)

Since ChatGPT doesn't have native webhooks, use a lightweight browser extension or manual flow:

**Option A: Browser Extension**
- Detects ChatGPT conversation completions
- Parses the output and offers a "Send to POCP" button
- Posts to Supabase Edge Function

**Option B: Manual Bridge**
- User copies ChatGPT output
- Pastes into the mobile approval app with a "Log from ChatGPT" action
- System creates a memory entry and optional approval

### 6.5 Antigravity IDE Connector

**Hook point:** IDE extension / plugin

```typescript
// Antigravity plugin: pocp-connector
export function onFileSave(event: FileSaveEvent) {
  const changes = computeDiff(event.previousContent, event.newContent);

  fetch(`${SUPABASE_URL}/functions/v1/submit-approval`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agent_name: 'antigravity-ide',
      title: `Modified: ${event.filePath}`,
      diff_payload: changes,
      risk_level: 'medium'
    })
  });
}
```

### 6.6 Excel Claude Connector

**Hook point:** Office Script triggered on sheet change or macro execution

```javascript
// Office Script: submitToApprovalQueue
async function main(workbook: ExcelScript.Workbook) {
  const sheet = workbook.getActiveWorksheet();
  const changes = detectChanges(sheet);

  const response = await fetch(`${SUPABASE_URL}/functions/v1/submit-approval`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agent_name: 'excel-claude',
      title: `Spreadsheet update: ${sheet.getName()}`,
      diff_payload: changes,
      risk_level: 'low'
    })
  });
}
```

---

## 7. Implementation Plan — Six-Terminal Build

This plan is designed so that six terminals can **build the system itself** in parallel.

### Sprint 1: Foundation (Week 1–2)

| Terminal | Agent | Task | Depends On |
|---|---|---|---|
| T1 | Cowork | Design & build mobile PWA shell (React + Supabase Auth) | — |
| T2 | Claude Code | Deploy Supabase schema (all tables, RLS, indexes) | — |
| T3 | Codex | Build Edge Functions (submit-approval, decide, heartbeat) | T2 |
| T4 | ChatGPT | Research best practices for mobile-first approval UIs | — |
| T5 | Antigravity | Build the approval card component (React) | T4 |
| T6 | Excel Claude | Create test data generator (populate queue with sample approvals) | T2 |

**Sprint 1 Gate:** Mobile app shows a live approval queue populated with test data.

### Sprint 2: Connectors (Week 3–5)

| Terminal | Agent | Task | Depends On |
|---|---|---|---|
| T1 | Cowork | Build Cowork connector (JS client integration) | Sprint 1 |
| T2 | Claude Code | Build Claude Code connector (hook scripts) | Sprint 1 |
| T3 | Codex | Build Codex connector (GitHub webhook handler) | Sprint 1 |
| T4 | ChatGPT | Build ChatGPT bridge (browser extension spec + prototype) | Sprint 1 |
| T5 | Antigravity | Build Antigravity IDE plugin | Sprint 1 |
| T6 | Excel Claude | Build Excel connector (Office Script) | Sprint 1 |

**Sprint 2 Gate:** All six surfaces can submit approvals. End-to-end test: submit from each surface, approve on phone.

### Sprint 3: Memory & Orchestration (Week 6–8)

| Terminal | Agent | Task | Depends On |
|---|---|---|---|
| T1 | Cowork | Build memory context panel in mobile UI | Sprint 2 |
| T2 | Claude Code | Implement memory read/write in Claude Code connector | Sprint 2 |
| T3 | Codex | Build Task Router Edge Function | Sprint 2 |
| T4 | ChatGPT | Design conflict resolution UX and decision trees | Sprint 2 |
| T5 | Antigravity | Build Conflict Resolver Edge Function | Sprint 2 |
| T6 | Excel Claude | Build analytics dashboard (approval metrics, agent utilization) | Sprint 2 |

**Sprint 3 Gate:** Agents share memory. Task Router assigns work. Conflicts detected and surfaced.

### Sprint 4: Intelligence & Polish (Week 9–12)

| Terminal | Agent | Task | Depends On |
|---|---|---|---|
| T1 | Cowork | Build weekly digest generator | Sprint 3 |
| T2 | Claude Code | Implement auto-risk classification | Sprint 3 |
| T3 | Codex | Build smart batching for low-risk approvals | Sprint 3 |
| T4 | ChatGPT | Write system documentation and runbooks | Sprint 3 |
| T5 | Antigravity | Build approval pattern learning (suggest auto-approve rules) | Sprint 3 |
| T6 | Excel Claude | Build LIFE_OS integration (sync tasks ↔ domains) | Sprint 3 |

**Sprint 4 Gate:** System is self-improving. Auto-approve works. LIFE_OS integrated. Documentation complete.

---

## 8. Agent Lifecycle Management

### 8.1 Registration

New agents register via Edge Function:

```
POST /functions/v1/register-agent
{
  "name": "new-agent-name",
  "type": "terminal",
  "capabilities": ["code", "files"]
}
```

### 8.2 Health Monitoring

- Agents send heartbeats every 60 seconds
- If no heartbeat for 3 minutes, agent marked `inactive`
- Inactive agents' tasks are redistributed
- Mobile surface shows agent health dashboard

### 8.3 Deregistration

Agents can be paused or removed from the mobile surface. Their pending tasks are reassigned and their memory entries remain in the system.

---

## 9. Scaling Beyond Six Terminals

The architecture supports N terminals with no code changes:

- **Add Terminal 7–12:** Register new agents, write connectors, deploy
- **Add AI models:** New LLMs (Gemini, Llama, etc.) just need a connector that speaks the message format
- **Add human agents:** People can be registered as agents who receive tasks and submit approvals through the same mobile surface
- **Multi-user:** Add team support by extending RLS policies to organization-level access

### 9.1 Scaling Thresholds

| Agents | Queue Strategy | Memory Strategy |
|---|---|---|
| 1–6 | Single Supabase table | Single memory table |
| 7–20 | Partitioned by priority | Partitioned by domain |
| 20–50 | Dedicated queue service (e.g., BullMQ) | Read replicas |
| 50+ | Distributed event stream (Kafka) | Sharded Postgres |

---

## 10. Monitoring & Observability

### 10.1 Key Dashboards (Mobile)

- **Active Agents:** Which terminals are alive and what they're working on
- **Approval Queue Depth:** How many items waiting for review
- **Task Throughput:** Tasks completed per hour across all agents
- **Memory Health:** Conflict rate, stale entries, coverage gaps
- **Agent Utilization:** Percentage of time each agent is actively working vs. idle

### 10.2 Alerts (Push Notifications)

- High-risk approval waiting > 5 minutes
- Agent offline for > 3 minutes
- Memory conflict detected
- Task failed after approval
- Queue depth exceeds 15 items

---

## 11. Security Considerations

- Each agent authenticates with a unique Supabase service role key
- Agent keys have scoped permissions (an agent can't approve its own work)
- All communication encrypted via HTTPS / WSS
- Audit log captures every message, approval, and memory write
- Rate limiting on Edge Functions prevents runaway agents
- File locks have mandatory expiration to prevent deadlocks

---

## 12. Glossary

| Term | Definition |
|---|---|
| **Agent** | An AI or human execution surface registered in the system |
| **Approval Request** | A structured request from an agent asking permission to execute |
| **Connector** | Code that bridges a surface to the Supabase orchestration layer |
| **Memory Entry** | A piece of knowledge written by an agent to the shared memory table |
| **Orchestrator** | The set of Edge Functions that route tasks, detect conflicts, and manage the queue |
| **POCP** | Parallel Operations Control Plane — the entire system |
| **Surface** | The UI or environment where an agent operates (terminal, desktop, browser, IDE) |
| **Task** | A unit of work that can be assigned to an agent |
