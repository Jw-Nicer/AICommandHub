# AGENT.md — Multi-Agent Orchestration & Parallel Execution Specification

**Version:** 2.1
**Author:** Johnwil
**Date:** 2026-03-10
**Status:** Draft — Foundation Scope Aligned
**Companion Document:** [Claude.md](./Claude.md) (Control Plane Spec)
**Platform:** Firebase / Google Cloud

---

## 1. Purpose

This document defines how six or more parallel execution terminals (agents) coordinate, execute, and report work under the Parallel Operations Control Plane (POCP) defined in Claude.md. It covers agent identity, capabilities, communication protocol, the six-terminal execution model, task routing, conflict avoidance, and the implementation plan for building the connectors and orchestration layer.

---

## 2. Agent Registry

Every execution surface is a registered agent with a defined identity, capabilities, and communication interface.

### 2.1 Agent Definitions

| # | Agent ID | Surface | Type | Primary Strengths | Connector Method |
|---|---|---|---|---|---|
| 1 | `cowork-desktop` | Claude Cowork | Desktop app | File creation, document generation, skill execution, browser automation | Native — Firebase JS SDK in session |
| 2 | `claude-code` | Claude Code | Terminal CLI | Code generation, git ops, testing, debugging, multi-file refactoring | CLI hook — pre/post task webhook to Cloud Function |
| 3 | `openai-codex` | OpenAI Codex | Cloud agent | Autonomous PR creation, long-running code tasks, repo-wide changes | GitHub webhook → Cloud Function |
| 4 | `chatgpt` | ChatGPT (web/mobile) | Browser/app | Research, analysis, writing, brainstorming, strategy | Browser extension or manual bridge |
| 5 | `antigravity-ide` | Antigravity IDE | Desktop IDE | Live coding, debugging, integrated terminal, project scaffolding | IDE plugin → Cloud Function HTTP |
| 6 | `excel-claude` | Excel + Claude | Desktop app | Data analysis, financial modeling, spreadsheet automation | Office Script / VBA → Cloud Function HTTP |

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

### 2.3 Agent Authentication Model

| Agent Type | Auth Method | How It Works |
|---|---|---|
| **Client-side** (Cowork, Antigravity) | Firebase ID token | User signs in via Firebase Auth SDK; token auto-refreshes |
| **CLI** (Claude Code) | Firebase custom token | Service account generates custom token; CLI exchanges for ID token |
| **Server-side** (Codex webhook handler) | Firebase Admin SDK | Cloud Function uses service account; no user token needed |
| **Browser extension** (ChatGPT bridge) | Firebase ID token | User signs in via popup; token stored in extension storage |
| **Office Script** (Excel) | Firebase ID token | User signs in once; token refreshed via helper function |

> **Critical:** All Cloud Functions derive `ownerId` from the authenticated token. Agents never pass `ownerId` in request bodies — this prevents impersonation.

---

## 3. Agent Communication Protocol

### 3.1 Message Format

All agents communicate through Cloud Functions and Firestore using a standardized message envelope:

```json
{
  "messageId": "uuid-v4",
  "fromAgent": "claude-code",
  "to": "orchestrator",
  "type": "approval_request | task_complete | memory_write | heartbeat | conflict_report",
  "payload": { },
  "timestamp": "2026-03-10T14:30:00Z",
  "correlationId": "task-uuid"
}
```

### 3.2 Message Types

**`approval_request`** — Agent asks for permission to execute something. Posts to `/submit-approval` Cloud Function. Routed to mobile approval surface (see Claude.md §6).

**`task_complete`** — Agent reports that assigned work is done. Posts to `/complete-task` Cloud Function. Includes output summary and memory entries.

**`memory_write`** — Agent contributes knowledge to the shared memory layer. Posts to `/write-memory` Cloud Function. Other agents can query this before starting work.

**`heartbeat`** — Every 60 seconds, each active agent posts to `/heartbeat` Cloud Function. Updates `lastHeartbeat` in the agent's `surfaces` document. Also serves as a polling fallback to receive pending assignments and decisions.

**`conflict_report`** — Agent detects it's about to modify something another agent is currently working on. Posts to `/conflict-report` Cloud Function. Escalates to orchestrator.

### 3.3 Communication Channels

Agents receive information through three mechanisms, depending on their type:

**1. Firestore onSnapshot (client-side agents)**
Client-side agents (Cowork, Antigravity, browser extensions) listen to Firestore documents directly for real-time updates:
```javascript
// Listen for decisions on a specific approval
onSnapshot(doc(db, 'approval_queue', approvalId), (snapshot) => {
  const data = snapshot.data();
  if (data.status !== 'pending') {
    // Decision received — act on it
  }
});
```

**2. Google Cloud Pub/Sub (server-side agents)**
Server-side Cloud Functions subscribe to the `pocp-agent-bus` topic for backend events:
```
Topic: pocp-agent-bus
  ├── Subscription: approvals-handler    (approval decisions)
  ├── Subscription: tasks-handler        (task assignments & completions)
  ├── Subscription: memory-handler       (memory writes & conflicts)
  └── Subscription: heartbeats-handler   (agent availability checks)
```

**3. Heartbeat polling (CLI agents)**
CLI agents (Claude Code) that can't maintain persistent connections poll via the `/heartbeat` endpoint, which returns pending decisions and task assignments in the response:
```json
{
  "acknowledged": true,
  "pendingDecisions": [
    { "approvalId": "uuid", "decision": "approved", "instructions": null }
  ],
  "pendingAssignments": [
    { "taskId": "uuid", "title": "Build auth module", "priority": 2 }
  ]
}
```

> **Why three channels?** Each agent type has different runtime constraints. Browser/desktop apps can hold open connections (onSnapshot). Cloud Functions respond to events (Pub/Sub). CLI tools run in short-lived sessions (polling).

---

## 4. Six-Terminal Execution Model

### 4.1 Concept

Six terminals run simultaneously. Each terminal hosts one agent. The orchestrator distributes tasks based on agent capability, current load, and task requirements.

```
┌─────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                         │
│             (Cloud Functions for Firebase)              │
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
2. **Load balancing:** Prefer the agent with the fewest active tasks (checked via `surfaces.currentTasks`)
3. **Affinity:** If an agent already has context about a project/file (checked via `memory` collection), prefer that agent
4. **Dependency:** If Task B depends on Task A's output (checked via `tasks.dependsOn`), assign Task B to the same agent when possible
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

When an agent begins modifying a file, it requests a lock via the `/lock-resource` Cloud Function. The lock is stored in the `locks` Firestore collection (see Claude.md §5.1):

```json
{
  "lockType": "file",
  "resource": "src/middleware/auth.js",
  "lockedBy": "claude-code",
  "surfaceId": "uuid",
  "lockedAt": "2026-03-10T14:30:00Z",
  "expiresAt": "2026-03-10T15:30:00Z"
}
```

Other agents check for locks before starting work on the same file. If locked, the Cloud Function returns `423 Locked` with details about who holds the lock and when it expires.

Locks have mandatory expiration (max 240 minutes) to prevent deadlocks. A scheduled Cloud Function (`cleanupExpiredLocks`) runs every 5 minutes to delete stale locks.

### 5.2 Semantic Conflict Detection

Beyond file-level locks, the orchestrator checks for semantic conflicts:

- Two agents modifying the same API contract (detected by overlapping `filePaths` in active approvals)
- One agent deleting a function another agent is extending (detected by diff analysis in Cloud Function)
- Contradictory architectural decisions in the memory collection (detected by `/write-memory` conflict check)

Semantic conflicts are escalated to the mobile approval surface via the `/conflict-report` Cloud Function, which creates an approval with a side-by-side comparison.

### 5.3 Resolution Priority

1. User decision (always highest priority)
2. Agent with more context (measured by memory entry count for that domain)
3. Agent that started first (temporal priority via `lockedAt` timestamp)
4. Orchestrator auto-merge if changes are non-overlapping

---

## 6. Connector Implementation Specifications

### 6.1 Claude Code Connector

**Hook point:** CLAUDE.md hooks (post-task)

**Auth:** Custom token generated from service account, exchanged for Firebase ID token at session start.

```bash
# .claude/hooks/post-task.sh
#!/bin/bash
# After each Claude Code task, submit approval if needed

TASK_OUTPUT=$(cat /tmp/claude-code-last-output.json)

# Map from Claude Code's output format to POCP format
RISK=$(node .claude/pocp/risk-assessor.js \
  --diff "$(git diff --staged)" \
  --files-changed "$(git diff --staged --numstat | wc -l)")

if [ "$RISK" != "low" ] || [ "$POCP_AUTO_APPROVE_LOW_RISK" != "true" ]; then
  # Get a fresh Firebase ID token (refreshed from custom token)
  FIREBASE_ID_TOKEN=$(node .claude/pocp/get-token.js)

  RESULT=$(curl -s -X POST "$CLOUD_FUNCTION_URL/submitApproval" \
    -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"agentName\": \"claude-code\",
      \"title\": \"$(git log --format=%s -1 HEAD 2>/dev/null || echo 'Code changes')\",
      \"description\": \"$(git diff --staged --stat | tail -1)\",
      \"diffPayload\": {
        \"type\": \"code_diff\",
        \"filesChanged\": $(git diff --staged --numstat | wc -l),
        \"insertions\": $(git diff --staged --numstat | awk '{s+=$1} END {print s+0}'),
        \"deletions\": $(git diff --staged --numstat | awk '{s+=$2} END {print s+0}'),
        \"preview\": $(git diff --staged | head -200 | jq -Rs .),
        \"structuredData\": {
          \"filePaths\": $(git diff --staged --name-only | jq -R -s 'split("\n") | map(select(. != ""))')
        }
      },
      \"riskLevel\": \"$RISK\",
      \"requiresApprovalBefore\": \"commit\"
    }")

  APPROVAL_ID=$(echo $RESULT | jq -r '.approvalId')

  echo "Waiting for approval ($APPROVAL_ID)..."
  # Poll via heartbeat until decision arrives
  DECISION=$(node .claude/pocp/wait-decision.js --id "$APPROVAL_ID" --timeout 3600)
  STATUS=$(echo $DECISION | jq -r '.decision')

  if [ "$STATUS" = "approved" ]; then
    echo "Approved — proceeding with commit"
    git commit
  elif [ "$STATUS" = "rejected" ]; then
    echo "Rejected: $(echo $DECISION | jq -r '.decisionNote')"
    git reset HEAD
  elif [ "$STATUS" = "modified" ]; then
    echo "Modification requested: $(echo $DECISION | jq -r '.modifications.instructions')"
  fi
fi
```

### 6.2 Cowork Connector

**Hook point:** Session lifecycle events

**Auth:** Firebase ID token via Firebase JS SDK sign-in.

Cowork sessions use the Firebase JS SDK directly:

```javascript
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function submitApproval(task) {
  // Option 1: Write directly to Firestore (Security Rules enforce ownerId)
  await addDoc(collection(db, 'approval_queue'), {
    agentName: 'cowork-desktop',
    title: task.title,
    description: task.description,
    diffPayload: {
      type: task.type || 'file_change',
      filesChanged: task.filePaths?.length || 0,
      structuredData: { filePaths: task.filePaths, changeType: task.changeType }
    },
    riskLevel: assessRisk(task),
    requiresApprovalBefore: 'execute',
    status: 'pending',
    ownerId: auth.currentUser.uid,
    requestedAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000)
  });

  // Option 2: Post to Cloud Function (preferred — Cloud Function sets ownerId)
  // const token = await auth.currentUser.getIdToken();
  // await fetch(`${CLOUD_FUNCTION_URL}/submitApproval`, {
  //   method: 'POST',
  //   headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ agentName: 'cowork-desktop', title: task.title, ... })
  // });
}
```

> **Direct Firestore write vs Cloud Function:** Standardize on the Cloud Function for production. Direct Firestore writes are acceptable only for local prototyping because they bypass validation, lock checks, queue positioning, and webhook-compatible processing.

### 6.3 OpenAI Codex Connector

**Hook point:** GitHub webhook on PR creation → Cloud Function

**Auth:** Cloud Function uses Firebase Admin SDK (no user token needed). The `ownerId` is resolved from the `openai-codex` surface document's owner.

```typescript
// functions/src/connectors/codex.ts
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

export const handleCodexPR = onRequest(async (req, res) => {
  // Verify GitHub webhook signature
  const signature = req.headers['x-hub-signature-256'];
  if (!verifyGitHubSignature(req.body, signature)) {
    res.status(401).send('Invalid signature');
    return;
  }

  const payload = req.body;
  if (payload.action !== 'opened' || !payload.pull_request) {
    res.status(200).send('ignored');
    return;
  }

  const pr = payload.pull_request;

  // Resolve ownerId from the codex surface document
  const surfaceSnap = await db.collection('surfaces')
    .where('name', '==', 'openai-codex')
    .limit(1).get();
  if (surfaceSnap.empty) {
    res.status(404).send('Codex surface not registered');
    return;
  }
  const surface = surfaceSnap.docs[0];
  const ownerId = surface.data().ownerId;

  // Assess risk
  let riskLevel = 'medium';
  if (pr.changed_files > 15 || pr.additions + pr.deletions > 500) riskLevel = 'high';
  if (pr.changed_files <= 2 && pr.additions + pr.deletions <= 20) riskLevel = 'low';
  if (/deploy|migration|production/i.test(pr.title)) riskLevel = 'critical';

  await db.collection('approval_queue').add({
    agentName: 'openai-codex',
    surfaceId: surface.id,
    title: `PR #${pr.number}: ${pr.title}`,
    description: pr.body || 'No description provided',
    diffPayload: {
      type: 'code_diff',
      filesChanged: pr.changed_files,
      insertions: pr.additions,
      deletions: pr.deletions,
      fullDiffUrl: pr.diff_url,
      structuredData: {
        prNumber: pr.number,
        prUrl: pr.html_url,
        branch: pr.head.ref,
        repo: pr.head.repo.full_name,
        filePaths: [] // fetched separately if needed
      }
    },
    riskLevel,
    requiresApprovalBefore: 'execute',
    status: 'pending',
    ownerId,
    requestedAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours
  });

  res.status(201).json({ status: 'queued' });
});
```

**Decision relay:** When the user approves/rejects, the `onApprovalDecided` Firestore trigger (Claude.md §5.4) publishes to Pub/Sub. A separate Cloud Function subscribes and uses the GitHub API to merge, close, or comment on the PR:

```typescript
// functions/src/connectors/codex-relay.ts
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { Octokit } from '@octokit/rest';

export const relayCodexDecision = onMessagePublished('pocp-agent-bus', async (event) => {
  const data = JSON.parse(Buffer.from(event.data.message.data, 'base64').toString());
  if (data.type !== 'approval_decided' || data.agentName !== 'openai-codex') return;

  const db = getFirestore();
  const approvalSnap = await db.collection('approval_queue').doc(data.approvalId).get();
  const approval = approvalSnap.data();
  const prNumber = approval?.diffPayload?.structuredData?.prNumber;
  const repo = approval?.diffPayload?.structuredData?.repo;
  if (!prNumber || !repo) return;

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const [owner, repoName] = repo.split('/');

  if (data.decision === 'approved') {
    await octokit.pulls.merge({ owner, repo: repoName, pull_number: prNumber });
  } else if (data.decision === 'rejected') {
    await octokit.pulls.update({ owner, repo: repoName, pull_number: prNumber, state: 'closed' });
    await octokit.issues.createComment({
      owner, repo: repoName, issue_number: prNumber,
      body: `Rejected via POCP: ${data.decisionNote || 'No reason provided'}`
    });
  } else if (data.decision === 'modified') {
    await octokit.issues.createComment({
      owner, repo: repoName, issue_number: prNumber,
      body: `Modifications requested via POCP:\n\n${data.modifications?.instructions || 'See approval details'}`
    });
  }
});
```

### 6.4 ChatGPT Connector (Bridge)

Since ChatGPT doesn't have native webhooks, treat this as a non-critical adapter. Use a lightweight browser extension or manual flow after the core platform is stable:

**Option A: Browser Extension**
- Detects ChatGPT conversation completions
- Parses the output and offers a "Send to POCP" button
- User signs in via Firebase Auth popup (once, stored in extension storage)
- Posts to Cloud Function HTTP endpoint with Firebase ID token

**Option B: Manual Bridge**
- User copies ChatGPT output
- Pastes into the mobile approval app with a "Log from ChatGPT" action
- System creates a memory entry and optional approval

### 6.5 Antigravity IDE Connector

**Hook point:** IDE extension / plugin

**Auth:** Firebase ID token via Firebase JS SDK.

```typescript
// Antigravity plugin: pocp-connector
export async function onFileSave(event: FileSaveEvent) {
  const changes = computeDiff(event.previousContent, event.newContent);
  const linesChanged = changes.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length;

  // Skip trivial changes
  if (linesChanged < 5) return;

  const token = await auth.currentUser.getIdToken();

  const response = await fetch(`${CLOUD_FUNCTION_URL}/submitApproval`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agentName: 'antigravity-ide',
      title: `Modified: ${event.filePath.split('/').pop()}`,
      description: `Changed ${linesChanged} lines in ${event.filePath}`,
      diffPayload: {
        type: 'code_diff',
        filesChanged: 1,
        insertions: changes.split('\n').filter(l => l.startsWith('+')).length,
        deletions: changes.split('\n').filter(l => l.startsWith('-')).length,
        preview: changes.substring(0, 2000),
        structuredData: { filePaths: [event.filePath] }
      },
      riskLevel: assessRisk(event.filePath, linesChanged),
      requiresApprovalBefore: 'commit'
    })
  });
}
```

### 6.6 Excel Claude Connector

**Hook point:** Office Script triggered on sheet change or macro execution

**Auth:** Firebase ID token obtained via an external sign-in helper or delegated desktop companion. Treat this as a phase-later adapter until the helper flow is proven in the target Excel environment.

```javascript
// Office Script: submitToApprovalQueue
async function main(workbook: ExcelScript.Workbook) {
  const sheet = workbook.getActiveWorksheet();
  const changes = detectChanges(sheet);

  // Token obtained from a cached sign-in flow
  const token = await getFirebaseIdToken();

  const response = await fetch(`${CLOUD_FUNCTION_URL}/submitApproval`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agentName: 'excel-claude',
      title: `Spreadsheet update: ${sheet.getName()}`,
      diffPayload: {
        type: 'data_change',
        structuredData: {
          sheetName: sheet.getName(),
          range: changes.range,
          rowCount: changes.rowCount,
          colCount: changes.colCount,
          summary: changes.summary
        }
      },
      riskLevel: assessFinancialRisk(sheet, changes)
    })
  });
}
```

---

## 7. Implementation Plan — Six-Terminal Build

This plan is designed so that six terminals can **build the system itself** in parallel.

### Sprint 0: Bootstrap (Week 0–1)

| Terminal | Agent | Task | Depends On |
|---|---|---|---|
| T1 | Cowork | Replace Next.js starter UI with a minimal queue shell in `mobile-pwa` | — |
| T2 | Claude Code | Initialize Firebase project files: `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `functions/` scaffold | — |
| T3 | Codex | Normalize API contracts and shared types across specs before backend implementation | T2 |
| T4 | ChatGPT | Review mobile approval UX patterns and queue-card information density | — |
| T5 | Antigravity | Prepare component inventory for approval cards, queue feed, and decision actions | T4 |
| T6 | Excel Claude | Define deferred connector constraints and sample structured payloads for spreadsheet changes | — |

**Sprint 0 Gate:** Repo contains a non-starter mobile shell, Firebase backend scaffold, and one canonical request/response contract.

### Sprint 1: Core Foundation (Week 1–2)

| Terminal | Agent | Task | Depends On |
|---|---|---|---|
| T1 | Cowork | Build mobile approval queue shell (React + Firebase Auth + Firebase Hosting) | Sprint 0 |
| T2 | Claude Code | Deploy Security Rules, indexes, seed `surfaces`, and register core surfaces | Sprint 0 |
| T3 | Codex | Build Cloud Functions: `submitApproval`, `decide`, `heartbeat`, `registerAgent` + triggers | Sprint 0 |
| T4 | ChatGPT | Research best practices for mobile-first approval UIs | — |
| T5 | Antigravity | Build the approval card component (React) | Sprint 0, T4 |
| T6 | Excel Claude | Create test data generator (populate Firestore with sample approvals) | Sprint 0, T2 |

**Sprint 1 Gate:** Mobile app shows a live approval queue populated with test data, approvals can be decided from the phone, and core backend paths work without experimental connectors.

### Sprint 2: Core Connectors (Week 3–5)

| Terminal | Agent | Task | Depends On |
|---|---|---|---|
| T1 | Cowork | Build Cowork connector (Firebase JS SDK integration) | Sprint 1 |
| T2 | Claude Code | Build Claude Code connector (hook scripts + token management) | Sprint 1 |
| T3 | Codex | Build Codex connector (GitHub webhook ingress → Cloud Function + Pub/Sub relay) | Sprint 1 |
| T4 | ChatGPT | Finalize ChatGPT bridge spec and manual fallback, but keep it off the critical path | Sprint 1 |
| T5 | Antigravity | Build Antigravity IDE plugin (file watcher + status bar) | Sprint 1 |
| T6 | Excel Claude | Validate Excel helper-auth approach and keep connector implementation optional for this sprint | Sprint 1 |

**Sprint 2 Gate:** Claude Code, Cowork, Antigravity, and Codex submit approvals end to end. ChatGPT and Excel remain optional adapters until their runtime constraints are proven.

### Sprint 3: Memory & Orchestration (Week 6–8)

| Terminal | Agent | Task | Depends On |
|---|---|---|---|
| T1 | Cowork | Build memory context panel in mobile UI | Sprint 2 |
| T2 | Claude Code | Implement memory read/write in Claude Code connector | Sprint 2 |
| T3 | Codex | Build Task Router Cloud Function | Sprint 2 |
| T4 | ChatGPT | Design conflict resolution UX and decision trees | Sprint 2 |
| T5 | Antigravity | Build Conflict Resolver Cloud Function + resource locking | Sprint 2 |
| T6 | Excel Claude | Build analytics dashboard (approval metrics, agent utilization) | Sprint 2 |

**Sprint 3 Gate:** Core agents share memory. Task Router assigns work. Conflicts are detected and surfaced for core code/file workflows.

### Sprint 4: Intelligence & Optional Adapters (Week 9–12)

| Terminal | Agent | Task | Depends On |
|---|---|---|---|
| T1 | Cowork | Build weekly digest generator | Sprint 3 |
| T2 | Claude Code | Implement auto-risk classification (Vertex AI) | Sprint 3 |
| T3 | Codex | Build smart batching for low-risk approvals | Sprint 3 |
| T4 | ChatGPT | Write system documentation and runbooks | Sprint 3 |
| T5 | Antigravity | Build approval pattern learning (suggest auto-approve rules) | Sprint 3 |
| T6 | Excel Claude | Build Excel connector only if helper-auth is proven; otherwise use this slot for LIFE_OS integration (sync tasks ↔ domains) | Sprint 3 |

**Sprint 4 Gate:** System is self-improving, auto-approve works for approved low-risk classes, optional adapters are either integrated or explicitly deferred, and documentation is complete.

---

## 8. Agent Lifecycle Management

### 8.1 Registration

New agents register via the `/registerAgent` Cloud Function:

```
POST /registerAgent
Authorization: Bearer <firebase-id-token>

{
  "name": "new-agent-name",
  "type": "terminal",
  "capabilities": ["code", "files"]
}
```

The Cloud Function:
1. Verifies the Firebase ID token
2. Checks for duplicate agent names under this user's `ownerId`
3. Creates a document in the `surfaces` collection with `ownerId` from the token
4. Returns `{ surfaceId, name, createdAt }`

### 8.2 Health Monitoring

- Agents send heartbeats every 60 seconds (POST to `/heartbeat`, updates `lastHeartbeat` in their `surfaces` document)
- A scheduled Cloud Function (`checkAgentHealth`, Cloud Scheduler, every 3 minutes) queries `surfaces` for stale heartbeats
- If no heartbeat for 3 minutes → agent marked `inactive`, pending tasks redistributed
- Mobile surface shows agent health dashboard with status rings (green/yellow/red/gray)

### 8.3 Deregistration

Agents can be paused or removed from the mobile surface. Their pending tasks are reassigned and their memory entries remain in the system.

---

## 9. Scaling Beyond Six Terminals

The architecture supports N terminals with no code changes:

- **Add Terminal 7–12:** Register new agents, write connectors, deploy
- **Add AI models:** New LLMs (Gemini, Llama, etc.) just need a connector that speaks the message format
- **Add human agents:** People can be registered as agents who receive tasks and submit approvals through the same mobile surface
- **Multi-user:** Add team support by extending Firestore Security Rules to organization-level access (add `orgId` field, check membership)

### 9.1 Scaling Thresholds

| Agents | Queue Strategy | Memory Strategy |
|---|---|---|
| 1–6 | Single Firestore collection | Single memory collection |
| 7–20 | Firestore with composite indexes by priority | Collection groups by domain |
| 20–50 | Cloud Tasks + Pub/Sub for reliable queue management | Firestore multi-region deployment |
| 50+ | Pub/Sub + Cloud Dataflow for event stream processing | Firestore sharded by domain + BigQuery for analytics |

---

## 10. Monitoring & Observability

### 10.1 Key Dashboards (Mobile)

- **Active Agents:** Which terminals are alive and what they're working on
- **Approval Queue Depth:** How many items waiting for review
- **Task Throughput:** Tasks completed per hour across all agents
- **Memory Health:** Conflict rate, stale entries, coverage gaps
- **Agent Utilization:** Percentage of time each agent is actively working vs. idle

### 10.2 Alerts (FCM Push Notifications)

- High-risk approval waiting > 5 minutes
- Agent offline for > 3 minutes
- Memory conflict detected
- Task failed after approval
- Queue depth exceeds 15 items

### 10.3 Backend Observability

- **Google Cloud Monitoring** — Cloud Function latency, error rates, invocation counts
- **Cloud Logging** — Structured logs from all Cloud Functions (queryable via Log Explorer)
- **Firebase Crashlytics** — Mobile PWA crash reporting
- **Firebase Performance Monitoring** — Client-side latency tracking (FCP, TTI, API call durations)

---

## 11. Security Considerations

- Each agent authenticates with Firebase Auth (custom tokens for server-side agents, ID tokens for client-side)
- `ownerId` is always derived from the authenticated token by Cloud Functions — never from request bodies
- Cloud Functions enforce business logic: agents cannot approve their own submissions (checked by comparing `request.auth.uid` against the submitting agent's surface ownership)
- Firestore Security Rules protect client-side access; Cloud Functions using Admin SDK bypass rules but enforce their own validation
- All communication encrypted via HTTPS
- Audit log captures every message, approval, and memory write (Firestore `execution_log` collection, immutable)
- Cloud Functions have rate limiting via Firebase App Check + per-agent throttling in function code
- File locks have mandatory expiration (max 240 minutes) to prevent deadlocks
- Sensitive config (GitHub tokens, API keys) stored in Google Secret Manager
- GitHub webhooks verified via HMAC signature (`x-hub-signature-256`)

---

## 12. Glossary

| Term | Definition |
|---|---|
| **Agent** | An AI or human execution surface registered in the system |
| **Approval Request** | A structured request from an agent asking permission to execute |
| **Cloud Function** | A serverless function in Cloud Functions for Firebase that handles orchestration logic |
| **Connector** | Code that bridges a surface to the Firebase orchestration layer |
| **Custom Token** | A Firebase Auth token generated by a service account, used by server-side agents to authenticate |
| **Firestore** | Google Cloud Firestore — the NoSQL document database used for all system state |
| **FCM** | Firebase Cloud Messaging — push notification service for mobile alerts |
| **ID Token** | A Firebase Auth token issued to authenticated users, used in `Authorization: Bearer` headers |
| **Memory Entry** | A piece of knowledge written by an agent to the shared `memory` collection |
| **Orchestrator** | The set of Cloud Functions that route tasks, detect conflicts, and manage the queue |
| **POCP** | Parallel Operations Control Plane — the entire system |
| **Pub/Sub** | Google Cloud Pub/Sub — backend event bus for reliable inter-function messaging |
| **Surface** | The UI or environment where an agent operates (terminal, desktop, browser, IDE) |
| **Task** | A unit of work that can be assigned to an agent |
