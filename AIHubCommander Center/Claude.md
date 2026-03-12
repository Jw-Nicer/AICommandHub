# CLAUDE.md — Unified Control Plane Specification

**Version:** 2.1
**Author:** Johnwil
**Date:** 2026-03-10
**Status:** Draft — Foundation Scope Aligned
**Platform:** Firebase / Google Cloud

---

## 1. Vision

A single, mobile-first approval surface that governs all parallel AI-assisted work happening across six or more execution surfaces — Claude Cowork (desktop), Claude Code (terminal), OpenAI Codex, ChatGPT, Antigravity IDE, and in-app Excel — while maintaining a durable, queryable system of records in Firebase (Cloud Firestore).

**Core principle:** _Work happens everywhere. Decisions happen in one place. Memory lives forever._

---

## 2. System Identity

| Property | Value |
|---|---|
| System Name | **Parallel Operations Control Plane (POCP)** |
| Approval Surface | Mobile-first PWA / native app |
| Memory Layer | Firebase (Cloud Firestore + Realtime Listeners + Cloud Functions) |
| Agent Protocol | Event-driven, queue-based |
| Auth Model | Firebase Authentication with Firestore Security Rules |

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
                   │ Firestore Realtime Listeners
┌──────────────────▼───────────────────────────────┐
│           LAYER 2: ORCHESTRATION                 │
│         (Cloud Functions for Firebase)           │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │ Task     │ │ Conflict │ │ Memory         │   │
│  │ Router   │ │ Resolver │ │ Consolidator   │   │
│  └──────────┘ └──────────┘ └────────────────┘   │
└──────────────────┬───────────────────────────────┘
                   │ Firestore + Cloud Tasks
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

### 4.2 Google Cloud Services Map

| Function | Service |
|---|---|
| Database & Realtime | Cloud Firestore |
| Authentication | Firebase Authentication |
| Serverless Functions | Cloud Functions for Firebase (2nd gen) |
| Push Notifications | Firebase Cloud Messaging (FCM) |
| File/Diff Storage | Cloud Storage for Firebase |
| Task Queuing | Google Cloud Tasks |
| Backend Event Bus | Google Cloud Pub/Sub |
| External Webhook Ingress | Public Cloud Functions + provider signature verification |
| Hosting (PWA) | Firebase Hosting |
| Monitoring | Google Cloud Monitoring + Firebase Crashlytics |
| Secrets | Google Secret Manager |

### 4.3 Data Flow

```
Agent completes work
       │
       ▼
1. Agent POSTs to Cloud Function /submit-approval
   (authenticated with Firebase ID token or custom token)
       │
       ▼
2. Cloud Function validates request, writes document
   to Firestore `approval_queue` collection
       │
       ├──► 3a. Firestore onSnapshot listener fires on
       │        mobile PWA (instant UI update)
       │
       └──► 3b. onDocumentCreated Cloud Function trigger
                sends FCM push notification to user's phone
       │
       ▼
4. User reviews on phone — sees context, diff, risk level
       │
       ▼
5. User taps Approve / Reject / Modify
   → Cloud Function /decide updates document in Firestore
       │
       ├──► 6a. Client-side agents (Cowork, Antigravity)
       │        pick up decision via onSnapshot listener
       │
       ├──► 6b. Server-side agents (Codex) pick up decision
       │        via onDocumentUpdated Cloud Function trigger
       │
       └──► 6c. CLI agents (Claude Code) pick up decision
                via heartbeat polling fallback
       │
       ▼
7. Agent executes, revises, or halts based on decision
       │
       ▼
8. Cloud Function logs outcome to `execution_log` collection
   and writes memory entries to `memory` collection
```

---

## 5. Firestore Schema (System of Records)

### 5.1 Collection Structure

Firestore uses a document-oriented model. Below is the complete collection hierarchy:

```
/surfaces/{surfaceId}
  - name: string               // 'claude-code', 'cowork', 'codex', etc.
  - type: string               // 'terminal', 'desktop', 'browser', 'mobile', 'ide'
  - status: string             // 'active' | 'inactive' | 'busy' | 'idle'
  - ownerId: string            // Firebase Auth UID
  - capabilities: array        // ['code', 'files', 'data', 'research', 'deploy']
  - lastHeartbeat: timestamp
  - currentTasks: array        // task IDs currently being worked on
  - metadata: map

/approval_queue/{approvalId}
  - surfaceId: string          // reference to surfaces doc
  - agentName: string          // 'claude-code', 'chatgpt', 'codex'
  - taskId: string             // reference to tasks doc (optional)
  - title: string              // short human-readable summary
  - description: string        // detailed context
  - diffPayload: map           // code diffs, file changes, structured output
    - type: string             // 'code_diff' | 'file_change' | 'data_change' | 'document' | 'other'
    - filesChanged: number
    - insertions: number
    - deletions: number
    - preview: string          // first 500 lines of diff
    - fullDiffUrl: string      // optional — link to full diff (e.g. GitHub PR)
    - structuredData: map      // optional — for non-code changes
  - riskLevel: string          // 'low', 'medium', 'high', 'critical' (default: 'low')
  - requiresApprovalBefore: string  // 'commit' | 'deploy' | 'execute' | 'publish'
  - status: string             // 'pending', 'approved', 'rejected', 'modified' (default: 'pending')
  - decisionNote: string       // user's note on why approved/rejected
  - modifications: map         // if status == 'modified': { instructions, revisedDiff }
  - ownerId: string            // Firebase Auth UID (for security rules)
  - requestedAt: timestamp     // serverTimestamp()
  - decidedAt: timestamp
  - expiresAt: timestamp       // auto-reject after expiry

/memory/{memoryId}
  - surfaceId: string          // reference to surfaces doc
  - domain: string             // 'codebase', 'project', 'decision', 'context'
  - key: string                // namespaced key like 'project:api:auth-strategy'
  - value: map                 // structured data (nested maps/arrays)
  - confidence: number         // 0.0–1.0, default 1.0
  - sourceApprovalId: string   // optional — links to the approval that generated this knowledge
  - ownerId: string            // Firebase Auth UID
  - createdAt: timestamp
  - updatedAt: timestamp
  - createdBy: string          // which agent wrote this

/execution_log/{logId}
  - approvalId: string         // reference to approval_queue doc
  - surfaceId: string          // reference to surfaces doc
  - agentName: string          // which agent executed
  - action: string             // what was done
  - outcome: string            // 'success', 'failure', 'partial'
  - output: map                // structured result data
  - ownerId: string            // Firebase Auth UID
  - executedAt: timestamp      // serverTimestamp()
  - durationMs: number

/tasks/{taskId}
  - title: string
  - description: string
  - status: string             // 'pending', 'assigned', 'in_progress', 'blocked', 'done' (default: 'pending')
  - assignedSurface: string    // reference to surfaces doc
  - priority: number           // 1 = critical, 5 = backlog (default: 3)
  - parentTaskId: string       // reference to parent task doc
  - dependsOn: array           // task IDs that must complete first
  - ownerId: string            // Firebase Auth UID
  - createdAt: timestamp
  - completedAt: timestamp
  - metadata: map

/locks/{lockId}
  - lockType: string           // 'file' | 'table' | 'api_endpoint' | 'domain'
  - resource: string           // resource path, e.g. 'src/middleware/auth.js'
  - lockedBy: string           // agent name
  - surfaceId: string          // reference to surfaces doc
  - ownerId: string            // Firebase Auth UID
  - lockedAt: timestamp
  - expiresAt: timestamp       // mandatory — max 240 minutes from lock time

/devices/{deviceId}
  - ownerId: string            // Firebase Auth UID
  - platform: string           // 'web' | 'ios' | 'android'
  - fcmTopic: string           // e.g. 'user_<uid>'
  - createdAt: timestamp
  - updatedAt: timestamp
```

### 5.2 Firestore Security Rules

> **Note:** Cloud Functions using the Firebase Admin SDK bypass these rules entirely. The rules below protect client-side access (mobile PWA, browser extensions, desktop apps using the Firebase JS SDK). Business logic rules (e.g. preventing self-approval) are enforced in Cloud Functions.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuthenticated() {
      return request.auth != null;
    }

    function isOwner() {
      return request.auth.uid == resource.data.ownerId;
    }

    function isNewOwner() {
      return request.auth.uid == request.resource.data.ownerId;
    }

    // Surfaces — user can only access their own
    match /surfaces/{surfaceId} {
      allow read, update, delete: if isAuthenticated() && isOwner();
      allow create: if isAuthenticated() && isNewOwner();
    }

    // Approval queue — user can only access their own approvals
    match /approval_queue/{approvalId} {
      allow read: if isAuthenticated() && isOwner();
      allow create: if isAuthenticated() && isNewOwner();
      // Only allow updating status, decisionNote, decidedAt, modifications
      allow update: if isAuthenticated() && isOwner()
        && request.resource.data.agentName == resource.data.agentName
        && request.resource.data.ownerId == resource.data.ownerId;
      allow delete: if false; // approvals are immutable once created
    }

    // Memory — user can only access their own memory entries
    match /memory/{memoryId} {
      allow read, update, delete: if isAuthenticated() && isOwner();
      allow create: if isAuthenticated() && isNewOwner();
    }

    // Execution log — user can only read their own logs (immutable)
    match /execution_log/{logId} {
      allow read: if isAuthenticated() && isOwner();
      allow create: if isAuthenticated() && isNewOwner();
      allow update, delete: if false; // logs are immutable
    }

    // Tasks — user can only access their own tasks
    match /tasks/{taskId} {
      allow read, update, delete: if isAuthenticated() && isOwner();
      allow create: if isAuthenticated() && isNewOwner();
    }

    // Locks — user can read all locks (need visibility), but only create/delete own
    match /locks/{lockId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated() && isNewOwner();
      allow update: if false; // locks are not updated, only created and deleted
      allow delete: if isAuthenticated() && isOwner();
    }
  }
}
```

### 5.3 Realtime Subscriptions

The mobile approval surface uses Firestore `onSnapshot` listeners for:
- `approval_queue` collection — filtered by `ownerId == auth.uid` and `status == 'pending'`
- `tasks` collection — filtered by `ownerId == auth.uid` for progress tracking
- `surfaces` collection — filtered by `ownerId == auth.uid` for agent health

```javascript
// Example: Listen for new pending approvals
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';

const q = query(
  collection(db, 'approval_queue'),
  where('ownerId', '==', auth.currentUser.uid),
  where('status', '==', 'pending'),
  orderBy('requestedAt', 'desc')
);

const unsubscribe = onSnapshot(q, (snapshot) => {
  snapshot.docChanges().forEach((change) => {
    if (change.type === 'added') {
      // New approval arrived — show in queue feed
    }
    if (change.type === 'modified') {
      // Status changed — update card or remove from feed
    }
    if (change.type === 'removed') {
      // Approval expired or deleted — remove from UI
    }
  });
});
```

### 5.4 Cloud Functions (Triggers & HTTP)

```typescript
// functions/src/approval.ts
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const db = getFirestore();

// HTTP: Agent submits an approval request
export const submitApproval = onRequest(async (req, res) => {
  // Verify Firebase ID token from Authorization header
  const idToken = req.headers.authorization?.replace('Bearer ', '');
  if (!idToken) { res.status(401).json({ error: 'unauthorized' }); return; }

  const decodedToken = await getAuth().verifyIdToken(idToken);
  const body = req.body;

  // Resolve surfaceId from agentName if not provided
  let surfaceId = body.surfaceId;
  if (!surfaceId && body.agentName) {
    const snap = await db.collection('surfaces')
      .where('name', '==', body.agentName)
      .where('ownerId', '==', decodedToken.uid)
      .limit(1).get();
    if (!snap.empty) surfaceId = snap.docs[0].id;
  }

  // Check for file locks if diff includes file paths
  if (body.diffPayload?.structuredData?.filePaths) {
    for (const filePath of body.diffPayload.structuredData.filePaths) {
      const lockSnap = await db.collection('locks')
        .where('resource', '==', filePath)
        .where('expiresAt', '>', new Date())
        .limit(1).get();
      if (!lockSnap.empty) {
        const lock = lockSnap.docs[0].data();
        res.status(409).json({
          error: 'resource_locked',
          message: `${filePath} is locked by ${lock.lockedBy}`,
          lockedBy: lock.lockedBy,
          expiresAt: lock.expiresAt.toDate().toISOString()
        });
        return;
      }
    }
  }

  const docRef = await db.collection('approval_queue').add({
    surfaceId,
    agentName: body.agentName,
    taskId: body.taskId || null,
    title: body.title,
    description: body.description || '',
    diffPayload: body.diffPayload || {},
    riskLevel: body.riskLevel || 'low',
    requiresApprovalBefore: body.requiresApprovalBefore || 'execute',
    status: 'pending',
    ownerId: decodedToken.uid,  // Always derived from auth token
    requestedAt: FieldValue.serverTimestamp(),
    decidedAt: null,
    expiresAt: body.expiresAt
      ? new Date(body.expiresAt)
      : new Date(Date.now() + 60 * 60 * 1000), // default 1 hour
  });

  // Count pending approvals for queue position
  const pendingSnap = await db.collection('approval_queue')
    .where('ownerId', '==', decodedToken.uid)
    .where('status', '==', 'pending')
    .count().get();

  res.status(201).json({
    approvalId: docRef.id,
    status: 'pending',
    queuePosition: pendingSnap.data().count,
    createdAt: new Date().toISOString()
  });
});

// Trigger: Send FCM push notification when new approval is created
export const onApprovalCreated = onDocumentCreated(
  'approval_queue/{approvalId}',
  async (event) => {
    const approval = event.data?.data();
    if (!approval) return;

    // The mobile app subscribes the signed-in device to topic `user_<uid>`
    // during notification opt-in / device registration.
    await getMessaging().send({
      topic: `user_${approval.ownerId}`,
      notification: {
        title: `${approval.agentName}: ${approval.riskLevel} risk`,
        body: approval.title,
      },
      data: {
        approvalId: event.params.approvalId,
        riskLevel: approval.riskLevel,
        deepLink: `/approval/${event.params.approvalId}`,
      },
    });
  }
);

// Trigger: When approval status changes, log outcome and notify agent
export const onApprovalDecided = onDocumentUpdated(
  'approval_queue/{approvalId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.status === 'pending' && after.status !== 'pending') {
      // 1. Write to execution_log
      await db.collection('execution_log').add({
        approvalId: event.params.approvalId,
        surfaceId: after.surfaceId,
        agentName: after.agentName,
        action: `approval_${after.status}`,
        outcome: after.status === 'approved' ? 'success' : 'halted',
        output: {
          decision: after.status,
          decisionNote: after.decisionNote || null,
          modifications: after.modifications || null,
        },
        ownerId: after.ownerId,
        executedAt: FieldValue.serverTimestamp(),
        durationMs: after.decidedAt && after.requestedAt
          ? after.decidedAt.toMillis() - after.requestedAt.toMillis()
          : null,
      });

      // 2. Publish to Pub/Sub for server-side agent notification
      //    (Client-side agents receive updates via onSnapshot automatically)
      const { PubSub } = require('@google-cloud/pubsub');
      const pubsub = new PubSub();
      await pubsub.topic('pocp-agent-bus').publishMessage({
        data: Buffer.from(JSON.stringify({
          type: 'approval_decided',
          approvalId: event.params.approvalId,
          agentName: after.agentName,
          surfaceId: after.surfaceId,
          decision: after.status,
          decisionNote: after.decisionNote,
          modifications: after.modifications,
        })),
        attributes: {
          eventType: 'approval_decided',
          agentName: after.agentName,
        },
      });
    }
  }
);

// Scheduled: Auto-reject expired approvals (runs every 5 minutes)
import { onSchedule } from 'firebase-functions/v2/scheduler';

export const autoRejectExpired = onSchedule('every 5 minutes', async () => {
  const now = new Date();
  const expiredSnap = await db.collection('approval_queue')
    .where('status', '==', 'pending')
    .where('expiresAt', '<=', now)
    .get();

  const batch = db.batch();
  expiredSnap.docs.forEach((doc) => {
    batch.update(doc.ref, {
      status: 'rejected',
      decisionNote: 'Auto-rejected: approval expired',
      decidedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
});

// Scheduled: Clean up expired locks (runs every 5 minutes)
export const cleanupExpiredLocks = onSchedule('every 5 minutes', async () => {
  const now = new Date();
  const expiredSnap = await db.collection('locks')
    .where('expiresAt', '<=', now)
    .get();

  const batch = db.batch();
  expiredSnap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
});
```

---

## 6. Approval Process Specification

### 6.1 Approval Request Schema

Every agent, regardless of surface, submits approvals via the `/submit-approval` Cloud Function. The Cloud Function derives `ownerId` from the authenticated token — agents never set it directly.

```json
{
  "agentName": "claude-code",
  "title": "Refactor auth middleware to use JWT",
  "description": "Replaced session-based auth with JWT tokens across 4 files",
  "riskLevel": "medium",
  "diffPayload": {
    "type": "code_diff",
    "filesChanged": 4,
    "insertions": 87,
    "deletions": 42,
    "preview": "--- a/middleware/auth.js\n+++ b/middleware/auth.js\n...",
    "structuredData": {
      "filePaths": ["middleware/auth.js", "config/jwt.js", "routes/login.js", "tests/auth.test.js"],
      "branch": "feature/jwt-auth",
      "repo": "AICommandHub"
    }
  },
  "requiresApprovalBefore": "commit",
  "expiresAt": "2026-03-10T18:00:00Z"
}
```

### 6.2 Risk Classification

| Level | Criteria | Auto-Approve Eligible |
|---|---|---|
| **Low** | Read-only, formatting, comments, docs-only | Yes (configurable) |
| **Medium** | Code changes, file modifications | No |
| **High** | Deployments, schema changes, API changes, >15 files | No |
| **Critical** | Destructive ops, production changes, financial, secrets | No, requires confirmation |

### 6.3 Approval Flow

```
Agent Work Complete
       │
       ▼
 Risk Assessment (local, in connector)
       │
  ┌────┴────┐
  │ Low     │ Medium/High/Critical
  │         │
  ▼         ▼
Auto-     POST /submit-approval
Approve?  (Cloud Function writes to Firestore)
  │         │
  │         ├──► FCM Push Notification to phone
  │         │
  │         ▼
  │    User Reviews on Phone
  │    (card with diff, context, risk badge)
  │         │
  │    ┌────┴────┐
  │    │         │
  │  Approve  Reject/Modify
  │    │         │
  │    ▼         ▼
  │  POST      POST /decide
  │  /decide   with modifications
  │    │         │
  │    ▼         ▼
  │  Agent     Agent receives
  │  executes  feedback, revises
  │    │         │
  └────┴─────────┘
       │
       ▼
  onApprovalDecided trigger:
  → Log to execution_log
  → Publish to Pub/Sub
  → Agent writes memory
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

Each agent, after completing approved work, writes a memory document to Firestore:

```json
{
  "domain": "codebase",
  "key": "api:auth:strategy",
  "value": {
    "approach": "JWT with refresh tokens",
    "decidedOn": "2026-03-10",
    "decidedBy": "claude-code",
    "rationale": "Stateless auth for microservice architecture",
    "filesAffected": ["middleware/auth.js", "config/jwt.js"]
  },
  "confidence": 0.95,
  "sourceApprovalId": "abc123"
}
```

### 7.2 Memory Conflict Resolution

When two agents write to the same key:
1. Higher confidence wins
2. If equal confidence, most recent wins
3. Conflict is flagged in `approval_queue` for user review
4. User's decision becomes the canonical memory entry

Conflict detection is handled by the `/write-memory` Cloud Function, not by Security Rules.

### 7.3 Memory Querying

Any agent can query the memory collection before starting work:

```javascript
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';

const memoryQuery = query(
  collection(db, 'memory'),
  where('domain', '==', 'codebase'),
  where('key', '>=', 'api:auth:'),
  where('key', '<=', 'api:auth:\uf8ff'),
  orderBy('key'),
  orderBy('confidence', 'desc'),
  limit(5)
);

const snapshot = await getDocs(memoryQuery);
snapshot.forEach((doc) => {
  console.log(doc.id, doc.data());
});
```

This prevents agents from contradicting established decisions.

> **Firestore index required:** This query needs a composite index on `(domain ASC, key ASC, confidence DESC)`. Defined in `firestore.indexes.json` and auto-deployed via `firebase deploy --only firestore:indexes`.

---

## 8. Development Phases

### Phase 0: Bootstrap (Week 0–1)

- Replace the default `mobile-pwa` starter UI with a minimal queue shell
- Initialize Firebase project files: `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`
- Create the `functions/` scaffold and shared types for HTTP/triggers
- Freeze one canonical contract: camelCase payload fields, `approval_queue` Firestore collection, and public webhook ingress only for provider callbacks

**Deliverable:** The repo has the backend scaffold, a non-starter mobile shell, and one normalized contract across docs and code examples.

### Phase 1: Foundation (Weeks 1–2)

- Create Firebase project and enable services (Firestore, Auth, Cloud Functions, Hosting, FCM)
- Deploy Firestore Security Rules via `firebase deploy --only firestore:rules`
- Deploy composite indexes via `firebase deploy --only firestore:indexes`
- Build Cloud Functions: `submitApproval`, `decide`, `heartbeat`, `registerAgent`
- Build Firestore triggers: `onApprovalCreated` (FCM push), `onApprovalDecided` (logging + Pub/Sub)
- Build scheduled functions: `autoRejectExpired`, `cleanupExpiredLocks`
- Stand up a minimal mobile PWA (React/Next.js) deployed on Firebase Hosting
- Seed Firestore with the 6 agent definitions in `surfaces` collection

**Deliverable:** A working queue where you can manually insert approvals and approve them from your phone. FCM is enabled only after device registration/topic subscription is wired.

### Phase 2: Core Connectors (Weeks 3–5)

- **Claude Code connector:** Hook into pre-commit / post-task to auto-submit approvals
- **Cowork connector:** Use CLAUDE.md / hooks to submit file changes for approval
- **Codex connector:** Public GitHub webhook ingress that captures Codex PRs and routes to approval queue
- **ChatGPT connector:** Browser extension or copy-paste bridge that captures ChatGPT outputs as an optional adapter
- **Antigravity connector:** IDE plugin or CLI wrapper that submits from the IDE
- **Excel connector:** VBA macro or Office Script that posts structured changes only after helper-auth is proven

**Deliverable:** Claude Code, Cowork, Antigravity, and Codex can submit approval requests end to end.

### Phase 3: Memory Layer (Weeks 6–7)

- Implement memory write protocol in each connector
- Build memory query and write Cloud Functions with conflict detection
- Add memory context panel to mobile approval UI
- Implement conflict detection and resolution flow

**Deliverable:** Agents read shared memory before starting work and write memory after completing it.

### Phase 4: Orchestration (Weeks 8–10)

- Build Task Router Cloud Function (assigns incoming tasks to best available surface)
- Build Conflict Resolver Cloud Function (detects when two agents work on the same thing)
- Add task dependency graph (Task A must complete before Task B starts)
- Implement parallel execution dashboard on mobile
- Use Google Cloud Tasks for reliable async task dispatch

**Deliverable:** You can dispatch a task and the system routes it to the right agent, avoids conflicts, and respects dependencies.

### Phase 5: Intelligence (Weeks 11–12)

- Auto-risk classification using Vertex AI analysis of diffs
- Smart batching (group related low-risk approvals)
- Approval pattern learning (suggest auto-approve rules based on history)
- Weekly digest: summarize all agent activity, decisions, and memory changes
- Optional adapters (ChatGPT, Excel) are either integrated against the proven contract or explicitly deferred

**Deliverable:** The system gets smarter over time and reduces approval friction.

---

## 9. Scalability Design

### 9.1 Horizontal Scaling

- **Surfaces:** Adding a new surface means writing one connector that implements the Approval Request Schema. No changes to the core system.
- **Agents:** Each agent is stateless. The queue is the coordination mechanism. Add more agents without coordination overhead.
- **Memory:** Firestore scales horizontally and automatically. For extreme throughput, shard by domain using collection groups.
- **Functions:** Cloud Functions for Firebase auto-scale to zero and burst on demand. No server management.

### 9.2 Latency Targets

| Path | Target |
|---|---|
| Agent → Cloud Function → Firestore | < 500ms |
| Firestore → Mobile (onSnapshot) | < 1s |
| FCM Push → Device | < 2s |
| Mobile → /decide → Agent notified | < 2s |

### 9.3 Offline Resilience

- Firestore has built-in offline persistence — PWA works offline automatically
- Decisions sync when connectivity returns (Firestore handles conflict resolution)
- Agents continue non-approval work while waiting
- Expired approvals auto-reject via scheduled Cloud Function (Cloud Scheduler)

---

## 10. Security Model

- User-surface API calls authenticated via Firebase Authentication (ID tokens for clients, custom tokens for server-side agents that can mint them)
- Provider callbacks such as GitHub webhooks use public Cloud Function ingress secured by provider signature verification and then execute with the Admin SDK
- Firestore Security Rules ensure client-side users can only read/write their own data
- Cloud Functions enforce business logic rules (e.g. agents cannot approve their own submissions — checked by comparing `request.auth.uid` against the approval's `surfaceId` ownership)
- `ownerId` is always derived from the authenticated token in Cloud Functions — never accepted from the request body
- Approval decisions include authenticated user ID + timestamp (from `request.auth`)
- Sensitive diffs (credentials, secrets) are flagged and redacted in the mobile view
- All memory writes are append-only with full audit trail
- Cloud Functions use Google Secret Manager for API keys and sensitive config
- Firebase App Check can be enabled to prevent unauthorized API abuse

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

---

## 13. Firebase-Specific Configuration

### 13.1 Required Firebase Services

Enable these in the Firebase Console:
- Cloud Firestore (Native mode, NOT Datastore mode)
- Firebase Authentication (Email/Password + Google Sign-In)
- Cloud Functions for Firebase (2nd generation, Node.js 20+)
- Firebase Hosting
- Firebase Cloud Messaging
- Firebase App Check (recommended)
- Google Cloud Pub/Sub (for backend agent notification)
- Google Cloud Scheduler (for scheduled functions)

### 13.2 Firestore Indexes

```json
{
  "indexes": [
    {
      "collectionGroup": "approval_queue",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "requestedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "approval_queue",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "expiresAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "memory",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "domain", "order": "ASCENDING" },
        { "fieldPath": "key", "order": "ASCENDING" },
        { "fieldPath": "confidence", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "tasks",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "priority", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "locks",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "resource", "order": "ASCENDING" },
        { "fieldPath": "expiresAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "surfaces",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "name", "order": "ASCENDING" },
        { "fieldPath": "ownerId", "order": "ASCENDING" }
      ]
    }
  ]
}
```

### 13.3 Project Structure

```
AICommandHub/
├── firebase.json              # Firebase project config
├── .firebaserc                # Project aliases
├── firestore.rules            # Security rules
├── firestore.indexes.json     # Composite indexes
├── functions/                 # Cloud Functions
│   ├── src/
│   │   ├── index.ts           # Function exports
│   │   ├── approval.ts        # Submit, decide, triggers, auto-reject
│   │   ├── memory.ts          # Query, write, conflict resolution
│   │   ├── tasks.ts           # Task routing & orchestration
│   │   ├── agents.ts          # Register, heartbeat, health check
│   │   └── locks.ts           # Resource locking & cleanup
│   ├── package.json
│   └── tsconfig.json
├── mobile-pwa/                # React PWA (approval surface)
│   └── ...
└── pocp-connector-sdk/        # SDK for agent connectors
    └── ...
```

### 13.4 Environment Variables

```bash
# Firebase project
FIREBASE_PROJECT_ID=your-project-id

# Cloud Function URLs (auto-generated after deploy)
CLOUD_FUNCTION_URL=https://<region>-<project-id>.cloudfunctions.net

# Client-side (set in mobile-pwa/.env.local)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Agent connectors (set per agent)
POCP_AGENT_NAME=claude-code      # matches agent registry
POCP_HEARTBEAT_INTERVAL_MS=60000
POCP_AUTO_APPROVE_LOW_RISK=false
```
