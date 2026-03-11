# Connector-Specs.md — Surface Connector Implementation Guide

**Version:** 2.0
**Platform:** Firebase / Google Cloud
**Author:** Johnwil
**Date:** 2026-03-10
**Parent Documents:** [Claude.md](./Claude.md) · [Agent.md](./Agent.md) · [API-Spec.md](./API-Spec.md)

---

## 1. Overview

Each execution surface needs a **connector** — a piece of code that bridges the surface to the Firebase orchestration layer. This document provides the full implementation specification for all six connectors, including architecture, code structure, configuration, and testing requirements.

Every connector must implement four core behaviors:

1. **Submit approvals** — Post work to the approval queue before execution
2. **Receive decisions** — Listen for approve/reject/modify responses
3. **Read/write memory** — Query shared knowledge before work, write knowledge after
4. **Send heartbeats** — Ping every 60 seconds to signal availability

---

## 2. Shared Connector SDK

All connectors share a common TypeScript/JavaScript SDK that handles authentication, HTTP calls, and Firestore snapshot subscriptions. Surface-specific connectors extend this base.

### 2.1 SDK Structure

```
pocp-connector-sdk/
├── src/
│   ├── index.ts                 (main export)
│   ├── client.ts                (Firebase client wrapper)
│   ├── approval.ts              (submit, poll, listen for decisions)
│   ├── memory.ts                (read, write, conflict check)
│   ├── heartbeat.ts             (60s interval ping)
│   ├── lock.ts                  (resource locking)
│   ├── task.ts                  (task assignment + completion)
│   └── types.ts                 (shared TypeScript interfaces)
├── package.json
└── tsconfig.json
```

### 2.2 Core Interfaces

```typescript
// types.ts

export interface ApprovalRequest {
  agentName: string;
  title: string;
  description?: string;
  diffPayload: DiffPayload;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApprovalBefore: 'commit' | 'deploy' | 'execute' | 'publish';
  expiresAt?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export interface DiffPayload {
  type: 'code_diff' | 'file_change' | 'data_change' | 'document' | 'other';
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  preview?: string;
  fullDiffUrl?: string;
  structuredData?: Record<string, unknown>;
}

export interface ApprovalDecision {
  approvalId: string;
  decision: 'approved' | 'rejected' | 'modified';
  decisionNote?: string;
  modifications?: {
    instructions?: string;
    revisedDiff?: Record<string, unknown>;
  };
}

export interface MemoryEntry {
  domain: 'codebase' | 'project' | 'decision' | 'context';
  key: string;
  value: Record<string, unknown>;
  confidence?: number;
  sourceApprovalId?: string;
}

export interface HeartbeatPayload {
  surfaceId: string;
  status: 'active' | 'busy' | 'idle';
  currentTasks: string[];
  load?: {
    cpuPercent?: number;
    memoryPercent?: number;
    queueDepth?: number;
  };
}

export interface ConnectorConfig {
  firebaseProjectId: string;
  firebaseApiKey: string;
  agentName: string;
  surfaceId: string;
  heartbeatIntervalMs?: number;  // default: 60000
  autoApproveRiskLevels?: string[];  // default: []
}
```

### 2.3 Base Client

```typescript
// client.ts

import { initializeApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore, collection, doc, addDoc, getDocs, query, where, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import { ConnectorConfig, ApprovalRequest, ApprovalDecision, MemoryEntry } from './types';

const CLOUD_FUNCTION_URL = process.env.CLOUD_FUNCTION_URL!;

export class POCPClient {
  private app: FirebaseApp;
  private db: Firestore;
  private auth: Auth;
  private config: ConnectorConfig;
  private heartbeatTimer: NodeJS.Timer | null = null;
  private unsubscribeDecision: Unsubscribe | null = null;

  constructor(config: ConnectorConfig) {
    this.config = config;
    this.app = initializeApp({
      projectId: config.firebaseProjectId,
      apiKey: config.firebaseApiKey,
    });
    this.db = getFirestore(this.app);
    this.auth = getAuth(this.app);
  }

  // --- Approval Methods ---

  async submitApproval(request: ApprovalRequest): Promise<{ approvalId: string }> {
    const idToken = await this.auth.currentUser?.getIdToken();
    const response = await fetch(`${CLOUD_FUNCTION_URL}/submit-approval`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...request, agentName: this.config.agentName }),
    });
    if (!response.ok) throw new Error(`Submit approval failed: ${response.statusText}`);
    const data = await response.json();
    return data;
  }

  async waitForDecision(approvalId: string, timeoutMs = 3600000): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Decision timeout')), timeoutMs);

      const approvalRef = doc(this.db, 'approval_queue', approvalId);
      this.unsubscribeDecision = onSnapshot(approvalRef, (snapshot) => {
        const data = snapshot.data();
        if (data && data.status !== 'pending') {
          clearTimeout(timeout);
          if (this.unsubscribeDecision) this.unsubscribeDecision();
          resolve({
            approvalId: approvalId,
            decision: data.status,
            decisionNote: data.decisionNote,
            modifications: data.modifications,
          });
        }
      });
    });
  }

  // --- Memory Methods ---

  async queryMemory(domain: string, keyPattern: string, limit = 10): Promise<MemoryEntry[]> {
    const idToken = await this.auth.currentUser?.getIdToken();
    const response = await fetch(`${CLOUD_FUNCTION_URL}/query-memory`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain, keyPattern, limit }),
    });
    if (!response.ok) throw new Error(`Query memory failed: ${response.statusText}`);
    const data = await response.json();
    return data.entries;
  }

  async writeMemory(entry: MemoryEntry): Promise<{ memoryId: string; conflictDetected: boolean }> {
    const idToken = await this.auth.currentUser?.getIdToken();
    const response = await fetch(`${CLOUD_FUNCTION_URL}/write-memory`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...entry, surfaceId: this.config.surfaceId }),
    });
    if (!response.ok) throw new Error(`Write memory failed: ${response.statusText}`);
    const data = await response.json();
    return data;
  }

  // --- Heartbeat ---

  startHeartbeat(getStatus: () => HeartbeatPayload): void {
    const interval = this.config.heartbeatIntervalMs || 60000;
    this.heartbeatTimer = setInterval(async () => {
      const payload = getStatus();
      const idToken = await this.auth.currentUser?.getIdToken();
      await fetch(`${CLOUD_FUNCTION_URL}/heartbeat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    }, interval);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  // --- Resource Locking ---

  async lockResource(resourcePath: string, durationMinutes = 60): Promise<{ lockId: string }> {
    const idToken = await this.auth.currentUser?.getIdToken();
    const response = await fetch(`${CLOUD_FUNCTION_URL}/lock-resource`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        surfaceId: this.config.surfaceId,
        resourceType: 'file',
        resourcePath: resourcePath,
        durationMinutes: durationMinutes,
      }),
    });
    if (!response.ok) throw new Error(`Lock failed: ${response.statusText}`);
    const data = await response.json();
    return data;
  }

  async unlockResource(lockId: string): Promise<void> {
    const idToken = await this.auth.currentUser?.getIdToken();
    await fetch(`${CLOUD_FUNCTION_URL}/unlock-resource`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lockId, surfaceId: this.config.surfaceId }),
    });
  }

  // --- Task Methods ---

  async completeTask(taskId: string, outcome: string, output: Record<string, unknown>, durationMs: number): Promise<void> {
    const idToken = await this.auth.currentUser?.getIdToken();
    await fetch(`${CLOUD_FUNCTION_URL}/complete-task`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        taskId,
        surfaceId: this.config.surfaceId,
        outcome,
        output,
        durationMs,
      }),
    });
  }

  // --- Cleanup ---

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.unsubscribeDecision) this.unsubscribeDecision();
  }
}
```

---

## 3. Connector #1: Claude Code (Terminal)

### 3.1 Architecture

Claude Code runs in a terminal. The connector hooks into Claude Code's lifecycle events using the hook system (`.claude/hooks/`).

```
Claude Code Session
       │
       ├── pre-task hook  → Query memory for context
       ├── task execution → Normal Claude Code work
       ├── post-task hook → Submit approval if needed
       │                    Wait for decision
       │                    Write memory on approval
       └── heartbeat      → Background process every 60s
```

### 3.2 File Structure

```
.claude/
├── hooks/
│   ├── pre-task.sh          (query memory, load context)
│   ├── post-task.sh         (submit approval, wait for decision)
│   └── heartbeat.sh         (background ping)
├── pocp/
│   ├── config.json          (Firebase project ID, API key, surface ID)
│   ├── connector.ts         (Node.js connector logic)
│   ├── risk-assessor.ts     (auto-classify risk from git diff)
│   └── diff-builder.ts      (build diffPayload from git state)
└── CLAUDE.md                (includes POCP context instructions)
```

### 3.3 Pre-Task Hook

```bash
#!/bin/bash
# .claude/hooks/pre-task.sh
# Runs before each Claude Code task

# Query relevant memory
CONTEXT=$(node .claude/pocp/connector.ts query-memory \
  --domain codebase \
  --key-pattern "$(basename $(pwd)):%" \
  --limit 5)

# Write context to temp file for Claude Code to read
echo "$CONTEXT" > /tmp/pocp-context.json
echo "POCP Context loaded: $(echo $CONTEXT | jq '.entries | length') memory entries"
```

### 3.4 Post-Task Hook

```bash
#!/bin/bash
# .claude/hooks/post-task.sh
# Runs after each Claude Code task

# Build diff payload
DIFF=$(git diff --staged --stat)
FILES_CHANGED=$(git diff --staged --numstat | wc -l)
INSERTIONS=$(git diff --staged --numstat | awk '{s+=$1} END {print s}')
DELETIONS=$(git diff --staged --numstat | awk '{s+=$2} END {print s}')

# Assess risk
RISK=$(node .claude/pocp/connector.ts assess-risk \
  --files-changed "$FILES_CHANGED" \
  --insertions "$INSERTIONS" \
  --deletions "$DELETIONS" \
  --diff "$(git diff --staged)")

# Submit approval
RESULT=$(node .claude/pocp/connector.ts submit-approval \
  --title "$(git log --format=%s -1 HEAD)" \
  --description "$(git log --format=%b -1 HEAD)" \
  --risk "$RISK" \
  --files-changed "$FILES_CHANGED" \
  --insertions "$INSERTIONS" \
  --deletions "$DELETIONS" \
  --preview "$(git diff --staged | head -200)")

APPROVAL_ID=$(echo $RESULT | jq -r '.approvalId')

if [ "$RISK" = "low" ]; then
  echo "Low risk — auto-approved"
else
  echo "Waiting for approval ($APPROVAL_ID)..."
  DECISION=$(node .claude/pocp/connector.ts wait-decision --id "$APPROVAL_ID" --timeout 3600)
  STATUS=$(echo $DECISION | jq -r '.decision')

  if [ "$STATUS" = "approved" ]; then
    echo "Approved — proceeding with commit"
    git commit
  elif [ "$STATUS" = "rejected" ]; then
    echo "Rejected — rolling back staged changes"
    git reset HEAD
  elif [ "$STATUS" = "modified" ]; then
    INSTRUCTIONS=$(echo $DECISION | jq -r '.modifications.instructions')
    echo "Modification requested: $INSTRUCTIONS"
  fi
fi
```

### 3.5 Risk Assessment Logic

```typescript
// risk-assessor.ts

export function assessRisk(diff: {
  filesChanged: number;
  insertions: number;
  deletions: number;
  filePaths: string[];
  diffContent: string;
}): 'low' | 'medium' | 'high' | 'critical' {

  // Critical: production configs, secrets, destructive operations
  const criticalPatterns = [
    /\.env/, /secret/i, /password/i, /api[_-]?key/i,
    /production/, /deploy/, /DROP TABLE/i, /DELETE FROM/i,
    /rm -rf/, /force push/
  ];
  if (criticalPatterns.some(p => p.test(diff.diffContent))) return 'critical';

  // High: schema changes, API changes, large refactors
  if (diff.filePaths.some(f => /migration|schema|\.sql/.test(f))) return 'high';
  if (diff.filesChanged > 15) return 'high';
  if (diff.insertions + diff.deletions > 500) return 'high';

  // Low: comments, formatting, docs, small changes
  if (diff.filesChanged <= 2 && diff.insertions + diff.deletions <= 20) return 'low';
  if (diff.filePaths.every(f => /\.md$|\.txt$|\.json$/.test(f))) return 'low';

  // Default: medium
  return 'medium';
}
```

---

## 4. Connector #2: Claude Cowork (Desktop)

### 4.1 Architecture

Cowork runs as a desktop app with access to the local file system and a Linux VM. The connector integrates via session-level JavaScript that calls Firebase directly.

```
Cowork Session
       │
       ├── Session start   → Register agent, start heartbeat
       ├── Before file ops → Check locks, query memory
       ├── After file ops  → Submit approval for non-trivial changes
       ├── On approval     → Execute the approved action
       └── Session end     → Stop heartbeat, deregister
```

### 4.2 Integration Pattern

Since Cowork executes JavaScript in a VM, the connector runs as a Node.js module:

```typescript
// cowork-connector.ts

import { POCPClient } from 'pocp-connector-sdk';

const client = new POCPClient({
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID!,
  firebaseApiKey: process.env.FIREBASE_API_KEY!,
  agentName: 'cowork-desktop',
  surfaceId: process.env.COWORK_SURFACE_ID!,
});

// Start heartbeat on session init
client.startHeartbeat(() => ({
  surfaceId: process.env.COWORK_SURFACE_ID!,
  status: 'active',
  currentTasks: getCurrentTaskIds(),
}));

// Before creating/modifying files, submit approval
export async function approveFileChange(
  title: string,
  description: string,
  filePaths: string[],
  changeType: 'create' | 'modify' | 'delete'
): Promise<boolean> {

  const riskLevel = changeType === 'delete' ? 'high' : 'medium';

  const { approvalId } = await client.submitApproval({
    agentName: 'cowork-desktop',
    title,
    description,
    diffPayload: {
      type: 'file_change',
      filesChanged: filePaths.length,
      structuredData: { filePaths, changeType }
    },
    riskLevel: riskLevel,
    requiresApprovalBefore: 'execute'
  });

  const decision = await client.waitForDecision(approvalId);
  return decision.decision === 'approved';
}
```

### 4.3 CLAUDE.md Integration

Add POCP instructions to the project's CLAUDE.md so Cowork sessions are aware of the control plane:

```markdown
## POCP Integration

Before modifying files:
1. Query memory for relevant context: `await client.queryMemory('project', 'relevant-key:%')`
2. Submit approval for non-trivial changes
3. Wait for approval before executing
4. Write memory entries after completing approved work
```

---

## 5. Connector #3: OpenAI Codex (Cloud Agent)

### 5.1 Architecture

Codex operates as a cloud agent that creates GitHub PRs. The connector is a Cloud Function triggered by GitHub webhooks.

```
Codex creates PR on GitHub
       │
       ▼
GitHub webhook fires (PR opened)
       │
       ▼
Cloud Function: handleCodexPr
       │
       ├── Extract PR metadata (title, body, diff stats)
       ├── Assess risk level
       ├── Insert into approval_queue collection
       │
       ▼
User approves on mobile
       │
       ▼
Cloud Function: relayCodexDecision (Firestore trigger)
       │
       ├── If approved → Merge PR via GitHub API
       ├── If rejected → Close PR with comment
       └── If modified → Add review comment with instructions
```

### 5.2 Cloud Function: handleCodexPr

```typescript
// functions/src/handleCodexPr.ts
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';

initializeApp();
const db = getFirestore();

export const handleCodexPr = onRequest(async (req, res) => {
  const payload = req.body;

  // Only handle PR opened events
  if (payload.action !== 'opened') {
    res.status(200).send('ignored');
    return;
  }

  const pr = payload.pull_request;

  // Assess risk
  let riskLevel = 'medium';
  if (pr.changed_files > 15 || pr.additions + pr.deletions > 500) riskLevel = 'high';
  if (pr.changed_files <= 2 && pr.additions + pr.deletions <= 20) riskLevel = 'low';
  if (pr.title.toLowerCase().includes('deploy') || pr.title.toLowerCase().includes('migration')) {
    riskLevel = 'critical';
  }

  // Get codex surface ID
  const surfaceSnapshot = await db.collection('surfaces')
    .where('name', '==', 'openai-codex')
    .limit(1)
    .get();

  const surface = surfaceSnapshot.docs[0];

  // Insert approval
  const approvalRef = await db.collection('approval_queue').add({
    surfaceId: surface.id,
    agentName: 'openai-codex',
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
        repo: pr.head.repo.full_name
      }
    },
    riskLevel: riskLevel,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() // 4 hours
  });

  res.status(201).json({ approvalId: approvalRef.id });
});
```

### 5.3 Decision Relay

When the user approves/rejects on mobile, a Firestore trigger fires:

```typescript
// functions/src/relayCodexDecision.ts
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

export const relayCodexDecision = onDocumentUpdated(
  'approval_queue/{approvalId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    // Only process when status changes from pending
    if (before.status === 'pending' && after.status !== 'pending' && after.agentName === 'openai-codex') {
      const prNumber = after.diffPayload?.structuredData?.prNumber;
      const repo = after.diffPayload?.structuredData?.repo;

      // Call GitHub API based on decision
      // (Implementation: use Octokit or fetch to merge/close/comment on PR)
      console.log(`Relaying decision "${after.status}" for PR #${prNumber} in ${repo}`);
    }
  }
);
```

---

## 6. Connector #4: ChatGPT (Browser Bridge)

### 6.1 Architecture

ChatGPT has no native webhook API. The connector uses a lightweight Chrome extension that detects ChatGPT conversation outputs and offers a "Send to POCP" button.

```
User chats with ChatGPT
       │
       ▼
Chrome Extension detects new response
       │
       ▼
Floating "Send to POCP" button appears
       │
       ▼
User clicks button
       │
       ├── Extension extracts conversation context
       ├── User selects: Memory Write | Approval Request | Task Note
       ├── Posts to Cloud Function
       └── Confirmation toast in browser
```

### 6.2 Chrome Extension Structure

```
chatgpt-pocp-bridge/
├── manifest.json
├── content.js              (injected into chatgpt.com)
├── popup.html              (extension popup for settings)
├── popup.js
├── background.js           (handles Firebase communication)
├── styles.css              (floating button + modal styles)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### 6.3 Content Script

```javascript
// content.js — injected into chatgpt.com

(function() {
  const CLOUD_FUNCTION_URL = ''; // loaded from extension storage
  const FIREBASE_ID_TOKEN = ''; // loaded from extension storage

  // Watch for new ChatGPT responses
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.querySelector && node.querySelector('[data-message-author-role="assistant"]')) {
          addPOCPButton(node);
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  function addPOCPButton(responseNode) {
    const btn = document.createElement('button');
    btn.textContent = '→ POCP';
    btn.className = 'pocp-send-btn';
    btn.onclick = () => showSendModal(responseNode);
    responseNode.appendChild(btn);
  }

  function showSendModal(responseNode) {
    const text = responseNode.innerText;
    const modal = document.createElement('div');
    modal.className = 'pocp-modal';
    modal.innerHTML = `
      <h3>Send to POCP</h3>
      <select id="pocp-action">
        <option value="memory">Save as Memory</option>
        <option value="approval">Submit for Approval</option>
        <option value="note">Add as Task Note</option>
      </select>
      <input id="pocp-title" placeholder="Title / Key" />
      <select id="pocp-domain">
        <option value="project">Project</option>
        <option value="codebase">Codebase</option>
        <option value="decision">Decision</option>
        <option value="context">Context</option>
      </select>
      <button id="pocp-submit">Send</button>
      <button id="pocp-cancel">Cancel</button>
    `;
    document.body.appendChild(modal);

    document.getElementById('pocp-submit').onclick = async () => {
      const action = document.getElementById('pocp-action').value;
      const title = document.getElementById('pocp-title').value;
      const domain = document.getElementById('pocp-domain').value;

      await chrome.runtime.sendMessage({
        type: 'pocp-send',
        action,
        title,
        domain,
        content: text
      });

      modal.remove();
    };

    document.getElementById('pocp-cancel').onclick = () => modal.remove();
  }
})();
```

### 6.4 Background Script

```javascript
// background.js — handles Firebase communication

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type !== 'pocp-send') return;

  const config = await chrome.storage.sync.get(['cloudFunctionUrl', 'firebaseIdToken', 'surfaceId']);

  if (message.action === 'memory') {
    await fetch(`${config.cloudFunctionUrl}/write-memory`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.firebaseIdToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        surfaceId: config.surfaceId,
        domain: message.domain,
        key: message.title,
        value: { content: message.content, source: 'chatgpt' },
        confidence: 0.8
      })
    });
  } else if (message.action === 'approval') {
    await fetch(`${config.cloudFunctionUrl}/submit-approval`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.firebaseIdToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agentName: 'chatgpt',
        title: message.title,
        description: message.content.substring(0, 5000),
        diffPayload: {
          type: 'document',
          structuredData: { fullContent: message.content }
        },
        riskLevel: 'medium',
        requiresApprovalBefore: 'execute'
      })
    });
  }
});
```

---

## 7. Connector #5: Antigravity IDE

### 7.1 Architecture

Antigravity is a desktop IDE. The connector is an IDE extension/plugin that hooks into file save events, terminal commands, and project actions.

```
Antigravity IDE
       │
       ├── File save event  → Compute diff, submit approval if significant
       ├── Terminal command  → Intercept deploy/build commands for approval
       ├── Project open      → Register agent, query memory for project context
       ├── Status bar        → Show POCP connection status + pending approvals
       └── Command palette   → "POCP: Submit approval", "POCP: Query memory"
```

### 7.2 Plugin Structure

```
antigravity-pocp-plugin/
├── src/
│   ├── extension.ts          (main entry point, activation/deactivation)
│   ├── file-watcher.ts       (monitors file saves, computes diffs)
│   ├── terminal-interceptor.ts (hooks into terminal for deploy commands)
│   ├── status-bar.ts         (shows POCP status in IDE footer)
│   ├── commands.ts           (command palette integrations)
│   ├── sidebar.ts            (optional: approval queue in IDE sidebar)
│   └── pocp-client.ts        (wraps the shared SDK)
├── package.json
└── README.md
```

### 7.3 File Watcher

```typescript
// file-watcher.ts

import { POCPClient } from 'pocp-connector-sdk';
import * as diff from 'diff';

export class FileWatcher {
  private client: POCPClient;
  private fileSnapshots: Map<string, string> = new Map();

  constructor(client: POCPClient) {
    this.client = client;
  }

  onFileOpen(filePath: string, content: string): void {
    this.fileSnapshots.set(filePath, content);
  }

  async onFileSave(filePath: string, newContent: string): Promise<void> {
    const oldContent = this.fileSnapshots.get(filePath);
    if (!oldContent) return;

    const changes = diff.createPatch(filePath, oldContent, newContent);
    const linesChanged = changes.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length;

    // Only submit approval for significant changes
    if (linesChanged < 5) {
      this.fileSnapshots.set(filePath, newContent);
      return;
    }

    // Check for resource lock
    try {
      const lock = await this.client.lockResource(filePath, 30);

      const { approvalId } = await this.client.submitApproval({
        agentName: 'antigravity-ide',
        title: `Modified: ${filePath.split('/').pop()}`,
        description: `Changed ${linesChanged} lines in ${filePath}`,
        diffPayload: {
          type: 'code_diff',
          filesChanged: 1,
          insertions: changes.split('\n').filter(l => l.startsWith('+')).length,
          deletions: changes.split('\n').filter(l => l.startsWith('-')).length,
          preview: changes.substring(0, 2000)
        },
        riskLevel: this.assessRisk(filePath, linesChanged),
        requiresApprovalBefore: 'commit'
      });

      // Update snapshot
      this.fileSnapshots.set(filePath, newContent);

      // Release lock after approval submitted
      await this.client.unlockResource(lock.lockId);
    } catch (error) {
      if (error.message.includes('already_locked')) {
        // Show notification: file is being edited by another agent
        showNotification(`${filePath} is locked by another agent. Save queued.`);
      }
    }
  }

  private assessRisk(filePath: string, linesChanged: number): 'low' | 'medium' | 'high' | 'critical' {
    if (/\.env|secret|password|key/i.test(filePath)) return 'critical';
    if (/migration|schema|\.sql/i.test(filePath)) return 'high';
    if (linesChanged < 10) return 'low';
    return 'medium';
  }
}
```

### 7.4 Status Bar

```typescript
// status-bar.ts

export class StatusBar {
  private element: StatusBarItem;
  private client: POCPClient;
  private pendingCount: number = 0;

  constructor(client: POCPClient) {
    this.client = client;
    this.element = createStatusBarItem('left');
    this.update();

    // Listen for queue changes
    setInterval(() => this.fetchPendingCount(), 30000);
  }

  private async fetchPendingCount(): Promise<void> {
    // Query pending approvals for this agent
    this.pendingCount = await this.client.getPendingCount();
    this.update();
  }

  private update(): void {
    if (this.pendingCount > 0) {
      this.element.text = `POCP: ${this.pendingCount} pending`;
      this.element.color = '#F59E0B';
    } else {
      this.element.text = 'POCP: Connected';
      this.element.color = '#10B981';
    }
  }
}
```

---

## 8. Connector #6: Excel Claude (In-App)

### 8.1 Architecture

Excel Claude runs inside Microsoft Excel using Office Scripts or VBA. The connector posts structured data changes only after an external helper-auth flow is proven in the target environment.

```
Excel + Claude in-app
       │
       ├── Sheet change event → Detect significant data modifications
       ├── Macro execution    → Wrap macro outputs in approval request
       ├── Formula audit      → Flag formulas that change financial outputs
       └── Manual trigger     → User clicks "Submit to POCP" ribbon button
```

### 8.2 Office Script Connector

```typescript
// ExcelPOCPConnector.ts (Office Script)

const CLOUD_FUNCTION_URL = "https://<region>-<project>.cloudfunctions.net";
const FIREBASE_ID_TOKEN = "<id-token>";
const SURFACE_ID = "<excel-surface-uuid>";

async function submitApproval(
  workbook: ExcelScript.Workbook,
  title: string,
  riskLevel: string
): Promise<void> {
  const sheet = workbook.getActiveWorksheet();
  const usedRange = sheet.getUsedRange();
  const values = usedRange.getValues();

  const payload = {
    agentName: "excel-claude",
    title: title,
    description: `Changes to sheet "${sheet.getName()}" in range ${usedRange.getAddress()}`,
    diffPayload: {
      type: "data_change",
      structuredData: {
        sheetName: sheet.getName(),
        range: usedRange.getAddress(),
        rowCount: values.length,
        colCount: values[0]?.length || 0,
        summary: buildChangeSummary(values)
      }
    },
    riskLevel: riskLevel,
    requiresApprovalBefore: "execute"
  };

  const response = await fetch(`${CLOUD_FUNCTION_URL}/submit-approval`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${FIREBASE_ID_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  console.log(`Approval submitted: ${result.approvalId}`);
}

function buildChangeSummary(values: (string | number | boolean)[][]): string {
  const rows = values.length;
  const cols = values[0]?.length || 0;
  const numericCells = values.flat().filter(v => typeof v === 'number').length;
  return `${rows} rows x ${cols} columns, ${numericCells} numeric cells`;
}

// Main entry point — called from ribbon button or macro
async function main(workbook: ExcelScript.Workbook): Promise<void> {
  await submitApproval(workbook, "Spreadsheet update", "low");
}
```

### 8.3 Financial Change Detection

For spreadsheets with financial data, the connector applies extra scrutiny:

```typescript
// financial-risk-assessor.ts (Office Script)

function assessFinancialRisk(
  workbook: ExcelScript.Workbook,
  changedRange: ExcelScript.Range
): 'low' | 'medium' | 'high' | 'critical' {

  const sheetName = changedRange.getWorksheet().getName().toLowerCase();
  const values = changedRange.getValues();

  // Critical: budget sheets, P&L, balance sheets
  if (/budget|p&l|balance|revenue|forecast/i.test(sheetName)) {
    return 'critical';
  }

  // High: formulas that reference financial ranges
  const formulas = changedRange.getFormulas();
  const hasFinancialFormulas = formulas.flat().some(f =>
    typeof f === 'string' && /SUM|AVERAGE|NPV|IRR|PMT/i.test(f)
  );
  if (hasFinancialFormulas) return 'high';

  // Medium: any numeric data changes
  const hasNumericChanges = values.flat().some(v => typeof v === 'number');
  if (hasNumericChanges) return 'medium';

  return 'low';
}
```

---

## 9. Testing Requirements

### 9.1 Per-Connector Test Matrix

Every connector must pass these tests before deployment:

| Test | Description | Pass Criteria |
|---|---|---|
| Submit approval | Post a valid approval request | Returns 201 with approvalId |
| Receive decision | Listen for and process an approval decision | Correctly handles approve/reject/modify |
| Memory read | Query memory for existing entries | Returns relevant entries with confidence scores |
| Memory write | Write a new memory entry | Entry appears in memory collection |
| Heartbeat | Send heartbeat and receive acknowledgment | 200 OK, pending assignments returned |
| Lock acquire | Request a file lock | Returns lockId |
| Lock conflict | Request a lock on an already-locked resource | Returns 423 with lock details |
| Lock release | Release a held lock | Lock removed from system |
| Risk assessment | Classify changes into correct risk level | Matches expected risk for test scenarios |
| Offline recovery | Handle Firebase downtime gracefully | Queues actions locally, syncs on reconnect |
| Auth failure | Handle expired or invalid token | Refreshes token or surfaces error |

### 9.2 Integration Test Scenario

End-to-end test across all six connectors:

1. Start all 6 agents (register + heartbeat)
2. Assign one task to each agent
3. Each agent completes work and submits approval
4. Verify all 6 approvals appear in mobile queue
5. Approve 3, reject 2, modify 1 from mobile
6. Verify agents received correct decisions
7. Verify memory entries written for approved work
8. Verify execution log entries created
9. Stop one agent, verify it's marked inactive
10. Verify its tasks are redistributed

---

## 10. Configuration Reference

### 10.1 Environment Variables (All Connectors)

```bash
FIREBASE_PROJECT_ID=<project-id>
FIREBASE_API_KEY=<api-key>
CLOUD_FUNCTION_URL=https://<region>-<project-id>.cloudfunctions.net
POCP_SURFACE_ID=<uuid>                        # Unique per connector
POCP_AGENT_NAME=<string>                      # Matches agent registry
POCP_HEARTBEAT_INTERVAL_MS=60000
POCP_AUTO_APPROVE_LOW_RISK=false
```

### 10.2 Setup Checklist Per Connector

- [ ] Register agent via `/register-agent`
- [ ] Store returned `surfaceId` in config
- [ ] Verify heartbeat reaches Firestore
- [ ] Submit a test approval and verify it appears in queue
- [ ] Approve the test from mobile and verify agent receives decision
- [ ] Write a test memory entry and verify it's queryable
- [ ] Run full integration test (SS9.2)

## 11. Contract Decisions

- HTTP payloads use camelCase field names.
- Firestore collections use snake_case names, including `approval_queue`.
- User-surface connectors authenticate with Firebase ID tokens.
- Provider callbacks such as GitHub webhooks use dedicated public ingress with signature verification and then write through the Admin SDK.
- ChatGPT and Excel are optional adapters until their runtime constraints are validated; they are not on the critical path for proving the platform.
