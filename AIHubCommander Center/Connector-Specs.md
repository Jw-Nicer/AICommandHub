# Connector-Specs.md — Surface Connector Implementation Guide

**Version:** 1.0
**Author:** Johnwil
**Date:** 2026-03-10
**Parent Documents:** [Claude.md](./Claude.md) · [Agent.md](./Agent.md) · [API-Spec.md](./API-Spec.md)

---

## 1. Overview

Each execution surface needs a **connector** — a piece of code that bridges the surface to the Supabase orchestration layer. This document provides the full implementation specification for all six connectors, including architecture, code structure, configuration, and testing requirements.

Every connector must implement four core behaviors:

1. **Submit approvals** — Post work to the approval queue before execution
2. **Receive decisions** — Listen for approve/reject/modify responses
3. **Read/write memory** — Query shared knowledge before work, write knowledge after
4. **Send heartbeats** — Ping every 60 seconds to signal availability

---

## 2. Shared Connector SDK

All connectors share a common TypeScript/JavaScript SDK that handles authentication, HTTP calls, and Realtime subscriptions. Surface-specific connectors extend this base.

### 2.1 SDK Structure

```
pocp-connector-sdk/
├── src/
│   ├── index.ts                 (main export)
│   ├── client.ts                (Supabase client wrapper)
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
  agent_name: string;
  title: string;
  description?: string;
  diff_payload: DiffPayload;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  requires_approval_before: 'commit' | 'deploy' | 'execute' | 'publish';
  expires_at?: string;
  task_id?: string;
  metadata?: Record<string, unknown>;
}

export interface DiffPayload {
  type: 'code_diff' | 'file_change' | 'data_change' | 'document' | 'other';
  files_changed?: number;
  insertions?: number;
  deletions?: number;
  preview?: string;
  full_diff_url?: string;
  structured_data?: Record<string, unknown>;
}

export interface ApprovalDecision {
  approval_id: string;
  decision: 'approved' | 'rejected' | 'modified';
  decision_note?: string;
  modifications?: {
    instructions?: string;
    revised_diff?: Record<string, unknown>;
  };
}

export interface MemoryEntry {
  domain: 'codebase' | 'project' | 'decision' | 'context';
  key: string;
  value: Record<string, unknown>;
  confidence?: number;
  source_approval_id?: string;
}

export interface HeartbeatPayload {
  surface_id: string;
  status: 'active' | 'busy' | 'idle';
  current_tasks: string[];
  load?: {
    cpu_percent?: number;
    memory_percent?: number;
    queue_depth?: number;
  };
}

export interface ConnectorConfig {
  supabaseUrl: string;
  supabaseKey: string;
  agentName: string;
  surfaceId: string;
  heartbeatIntervalMs?: number;  // default: 60000
  autoApproveRiskLevels?: string[];  // default: []
}
```

### 2.3 Base Client

```typescript
// client.ts

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { ConnectorConfig, ApprovalRequest, ApprovalDecision, MemoryEntry } from './types';

export class POCPClient {
  private supabase: SupabaseClient;
  private channel: RealtimeChannel;
  private config: ConnectorConfig;
  private heartbeatTimer: NodeJS.Timer | null = null;

  constructor(config: ConnectorConfig) {
    this.config = config;
    this.supabase = createClient(config.supabaseUrl, config.supabaseKey);
    this.channel = this.supabase.channel('agent-bus');
  }

  // --- Approval Methods ---

  async submitApproval(request: ApprovalRequest): Promise<{ approval_id: string }> {
    const { data, error } = await this.supabase.functions.invoke('submit-approval', {
      body: { ...request, agent_name: this.config.agentName }
    });
    if (error) throw new Error(`Submit approval failed: ${error.message}`);
    return data;
  }

  async waitForDecision(approvalId: string, timeoutMs = 3600000): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Decision timeout')), timeoutMs);

      this.channel
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'approval_queue',
          filter: `id=eq.${approvalId}`
        }, (payload) => {
          if (payload.new.status !== 'pending') {
            clearTimeout(timeout);
            resolve({
              approval_id: approvalId,
              decision: payload.new.status,
              decision_note: payload.new.decision_note,
              modifications: payload.new.modifications
            });
          }
        })
        .subscribe();
    });
  }

  // --- Memory Methods ---

  async queryMemory(domain: string, keyPattern: string, limit = 10): Promise<MemoryEntry[]> {
    const { data, error } = await this.supabase.functions.invoke('query-memory', {
      body: { domain, key_pattern: keyPattern, limit }
    });
    if (error) throw new Error(`Query memory failed: ${error.message}`);
    return data.entries;
  }

  async writeMemory(entry: MemoryEntry): Promise<{ memory_id: string; conflict_detected: boolean }> {
    const { data, error } = await this.supabase.functions.invoke('write-memory', {
      body: { ...entry, surface_id: this.config.surfaceId }
    });
    if (error) throw new Error(`Write memory failed: ${error.message}`);
    return data;
  }

  // --- Heartbeat ---

  startHeartbeat(getStatus: () => HeartbeatPayload): void {
    const interval = this.config.heartbeatIntervalMs || 60000;
    this.heartbeatTimer = setInterval(async () => {
      const payload = getStatus();
      await this.supabase.functions.invoke('heartbeat', { body: payload });
    }, interval);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  // --- Resource Locking ---

  async lockResource(resourcePath: string, durationMinutes = 60): Promise<{ lock_id: string }> {
    const { data, error } = await this.supabase.functions.invoke('lock-resource', {
      body: {
        surface_id: this.config.surfaceId,
        resource_type: 'file',
        resource_path: resourcePath,
        duration_minutes: durationMinutes
      }
    });
    if (error) throw new Error(`Lock failed: ${error.message}`);
    return data;
  }

  async unlockResource(lockId: string): Promise<void> {
    await this.supabase.functions.invoke('unlock-resource', {
      body: { lock_id: lockId, surface_id: this.config.surfaceId }
    });
  }

  // --- Task Methods ---

  async completeTask(taskId: string, outcome: string, output: Record<string, unknown>, durationMs: number): Promise<void> {
    await this.supabase.functions.invoke('complete-task', {
      body: {
        task_id: taskId,
        surface_id: this.config.surfaceId,
        outcome,
        output,
        duration_ms: durationMs
      }
    });
  }

  // --- Cleanup ---

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    await this.supabase.removeChannel(this.channel);
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
│   ├── config.json          (Supabase URL, key, surface ID)
│   ├── connector.ts         (Node.js connector logic)
│   ├── risk-assessor.ts     (auto-classify risk from git diff)
│   └── diff-builder.ts      (build diff_payload from git state)
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

APPROVAL_ID=$(echo $RESULT | jq -r '.approval_id')

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

Cowork runs as a desktop app with access to the local file system and a Linux VM. The connector integrates via session-level JavaScript that calls Supabase directly.

```
Cowork Session
       │
       ├── Session start   → Register agent, start heartbeat
       ├── Before file ops → Check locks, query memory
       ├── After file ops  → Submit approval for non-trivial changes
       ├── On approval     → Execute the approved action
       └── Session end     → Stop heartbeat, deregister
```

### 3.2 Integration Pattern

Since Cowork executes JavaScript in a VM, the connector runs as a Node.js module:

```typescript
// cowork-connector.ts

import { POCPClient } from 'pocp-connector-sdk';

const client = new POCPClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_ANON_KEY!,
  agentName: 'cowork-desktop',
  surfaceId: process.env.COWORK_SURFACE_ID!,
});

// Start heartbeat on session init
client.startHeartbeat(() => ({
  surface_id: process.env.COWORK_SURFACE_ID!,
  status: 'active',
  current_tasks: getCurrentTaskIds(),
}));

// Before creating/modifying files, submit approval
export async function approveFileChange(
  title: string,
  description: string,
  filePaths: string[],
  changeType: 'create' | 'modify' | 'delete'
): Promise<boolean> {

  const riskLevel = changeType === 'delete' ? 'high' : 'medium';

  const { approval_id } = await client.submitApproval({
    agent_name: 'cowork-desktop',
    title,
    description,
    diff_payload: {
      type: 'file_change',
      files_changed: filePaths.length,
      structured_data: { filePaths, changeType }
    },
    risk_level: riskLevel,
    requires_approval_before: 'execute'
  });

  const decision = await client.waitForDecision(approval_id);
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

Codex operates as a cloud agent that creates GitHub PRs. The connector is a Supabase Edge Function triggered by GitHub webhooks.

```
Codex creates PR on GitHub
       │
       ▼
GitHub webhook fires (PR opened)
       │
       ▼
Supabase Edge Function: handle-codex-pr
       │
       ├── Extract PR metadata (title, body, diff stats)
       ├── Assess risk level
       ├── Insert into approval_queue
       │
       ▼
User approves on mobile
       │
       ▼
Edge Function: relay-codex-decision
       │
       ├── If approved → Merge PR via GitHub API
       ├── If rejected → Close PR with comment
       └── If modified → Add review comment with instructions
```

### 5.2 Edge Function: handle-codex-pr

```typescript
// supabase/functions/handle-codex-pr/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const payload = await req.json();

  // Only handle PR opened events
  if (payload.action !== 'opened') {
    return new Response('ignored', { status: 200 });
  }

  const pr = payload.pull_request;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Assess risk
  let riskLevel = 'medium';
  if (pr.changed_files > 15 || pr.additions + pr.deletions > 500) riskLevel = 'high';
  if (pr.changed_files <= 2 && pr.additions + pr.deletions <= 20) riskLevel = 'low';
  if (pr.title.toLowerCase().includes('deploy') || pr.title.toLowerCase().includes('migration')) {
    riskLevel = 'critical';
  }

  // Get codex surface ID
  const { data: surface } = await supabase
    .from('surfaces')
    .select('id')
    .eq('name', 'openai-codex')
    .single();

  // Insert approval
  const { data: approval, error } = await supabase
    .from('approval_queue')
    .insert({
      surface_id: surface.id,
      agent_name: 'openai-codex',
      title: `PR #${pr.number}: ${pr.title}`,
      description: pr.body || 'No description provided',
      diff_payload: {
        type: 'code_diff',
        files_changed: pr.changed_files,
        insertions: pr.additions,
        deletions: pr.deletions,
        full_diff_url: pr.diff_url,
        structured_data: {
          pr_number: pr.number,
          pr_url: pr.html_url,
          branch: pr.head.ref,
          repo: pr.head.repo.full_name
        }
      },
      risk_level: riskLevel,
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() // 4 hours
    })
    .select()
    .single();

  return new Response(JSON.stringify({ approval_id: approval.id }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

### 5.3 Decision Relay

When the user approves/rejects on mobile, a database trigger fires:

```sql
-- Trigger function: relay Codex decisions to GitHub
CREATE OR REPLACE FUNCTION relay_codex_decision()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.agent_name = 'openai-codex' AND NEW.status != 'pending' THEN
    -- Call Edge Function to interact with GitHub API
    PERFORM net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/relay-codex-decision',
      body := jsonb_build_object(
        'approval_id', NEW.id,
        'decision', NEW.status,
        'decision_note', NEW.decision_note,
        'pr_number', NEW.diff_payload->'structured_data'->>'pr_number',
        'repo', NEW.diff_payload->'structured_data'->>'repo'
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
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
       ├── Posts to Supabase Edge Function
       └── Confirmation toast in browser
```

### 6.2 Chrome Extension Structure

```
chatgpt-pocp-bridge/
├── manifest.json
├── content.js              (injected into chatgpt.com)
├── popup.html              (extension popup for settings)
├── popup.js
├── background.js           (handles Supabase communication)
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
  const SUPABASE_URL = ''; // loaded from extension storage
  const SUPABASE_KEY = ''; // loaded from extension storage

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
// background.js — handles Supabase communication

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type !== 'pocp-send') return;

  const config = await chrome.storage.sync.get(['supabaseUrl', 'supabaseKey', 'surfaceId']);

  if (message.action === 'memory') {
    await fetch(`${config.supabaseUrl}/functions/v1/write-memory`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        surface_id: config.surfaceId,
        domain: message.domain,
        key: message.title,
        value: { content: message.content, source: 'chatgpt' },
        confidence: 0.8
      })
    });
  } else if (message.action === 'approval') {
    await fetch(`${config.supabaseUrl}/functions/v1/submit-approval`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent_name: 'chatgpt',
        title: message.title,
        description: message.content.substring(0, 5000),
        diff_payload: {
          type: 'document',
          structured_data: { full_content: message.content }
        },
        risk_level: 'medium',
        requires_approval_before: 'execute'
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

      const { approval_id } = await this.client.submitApproval({
        agent_name: 'antigravity-ide',
        title: `Modified: ${filePath.split('/').pop()}`,
        description: `Changed ${linesChanged} lines in ${filePath}`,
        diff_payload: {
          type: 'code_diff',
          files_changed: 1,
          insertions: changes.split('\n').filter(l => l.startsWith('+')).length,
          deletions: changes.split('\n').filter(l => l.startsWith('-')).length,
          preview: changes.substring(0, 2000)
        },
        risk_level: this.assessRisk(filePath, linesChanged),
        requires_approval_before: 'commit'
      });

      // Update snapshot
      this.fileSnapshots.set(filePath, newContent);

      // Release lock after approval submitted
      await this.client.unlockResource(lock.lock_id);
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

Excel Claude runs inside Microsoft Excel using Office Scripts or VBA. The connector posts structured data changes to Supabase when significant spreadsheet modifications occur.

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

const SUPABASE_URL = "https://<project>.supabase.co";
const SUPABASE_KEY = "<anon-key>";
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
    agent_name: "excel-claude",
    title: title,
    description: `Changes to sheet "${sheet.getName()}" in range ${usedRange.getAddress()}`,
    diff_payload: {
      type: "data_change",
      structured_data: {
        sheet_name: sheet.getName(),
        range: usedRange.getAddress(),
        row_count: values.length,
        col_count: values[0]?.length || 0,
        summary: buildChangeSummary(values)
      }
    },
    risk_level: riskLevel,
    requires_approval_before: "execute"
  };

  const response = await fetch(`${SUPABASE_URL}/functions/v1/submit-approval`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  console.log(`Approval submitted: ${result.approval_id}`);
}

function buildChangeSummary(values: (string | number | boolean)[][]): string {
  const rows = values.length;
  const cols = values[0]?.length || 0;
  const numericCells = values.flat().filter(v => typeof v === 'number').length;
  return `${rows} rows × ${cols} columns, ${numericCells} numeric cells`;
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
| Submit approval | Post a valid approval request | Returns 201 with approval_id |
| Receive decision | Listen for and process an approval decision | Correctly handles approve/reject/modify |
| Memory read | Query memory for existing entries | Returns relevant entries with confidence scores |
| Memory write | Write a new memory entry | Entry appears in memory table |
| Heartbeat | Send heartbeat and receive acknowledgment | 200 OK, pending assignments returned |
| Lock acquire | Request a file lock | Returns lock_id |
| Lock conflict | Request a lock on an already-locked resource | Returns 423 with lock details |
| Lock release | Release a held lock | Lock removed from system |
| Risk assessment | Classify changes into correct risk level | Matches expected risk for test scenarios |
| Offline recovery | Handle Supabase downtime gracefully | Queues actions locally, syncs on reconnect |
| Auth failure | Handle expired or invalid JWT | Refreshes token or surfaces error |

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
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>  # Edge Functions only
POCP_SURFACE_ID=<uuid>                        # Unique per connector
POCP_AGENT_NAME=<string>                      # Matches agent registry
POCP_HEARTBEAT_INTERVAL_MS=60000
POCP_AUTO_APPROVE_LOW_RISK=false
```

### 10.2 Setup Checklist Per Connector

- [ ] Register agent via `/register-agent`
- [ ] Store returned `surface_id` in config
- [ ] Verify heartbeat reaches Supabase
- [ ] Submit a test approval and verify it appears in queue
- [ ] Approve the test from mobile and verify agent receives decision
- [ ] Write a test memory entry and verify it's queryable
- [ ] Run full integration test (§9.2)
