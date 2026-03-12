// POCP Shared Types — Single source of truth for Firestore documents and API contracts
// Referenced by: functions/, mobile-pwa/, pocp-connector-sdk/

// === Firestore Document Types (from CLAUDE.md §5.1) ===

export interface Surface {
  name: string;
  type: 'terminal' | 'desktop' | 'browser' | 'mobile' | 'ide';
  status: 'active' | 'inactive' | 'busy' | 'idle';
  ownerId: string;
  capabilities: string[];
  lastHeartbeat: unknown; // Timestamp (server) or null
  currentTasks: string[];
  metadata: Record<string, unknown>;
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

export interface ApprovalQueueItem {
  surfaceId: string;
  agentName: string;
  taskId: string | null;
  title: string;
  description: string;
  diffPayload: DiffPayload;
  riskLevel: RiskLevel;
  requiresApprovalBefore: 'commit' | 'deploy' | 'execute' | 'publish';
  status: 'pending' | 'approved' | 'rejected' | 'modified';
  decisionNote: string | null;
  modifications: { instructions?: string; revisedDiff?: Record<string, unknown> } | null;
  ownerId: string;
  requestedAt: unknown; // Timestamp
  decidedAt: unknown; // Timestamp | null
  expiresAt: unknown; // Timestamp
}

export interface MemoryEntry {
  surfaceId: string;
  domain: 'codebase' | 'project' | 'decision' | 'context';
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  sourceApprovalId: string | null;
  ownerId: string;
  createdAt: unknown; // Timestamp
  updatedAt: unknown; // Timestamp
  createdBy: string;
}

export interface ExecutionLog {
  approvalId: string;
  surfaceId: string;
  agentName: string;
  action: string;
  outcome: 'success' | 'failure' | 'partial';
  output: Record<string, unknown>;
  ownerId: string;
  executedAt: unknown; // Timestamp
  durationMs: number | null;
}

export interface Task {
  title: string;
  description: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'blocked' | 'done';
  assignedSurface: string;
  priority: number;
  parentTaskId: string | null;
  dependsOn: string[];
  ownerId: string;
  createdAt: unknown; // Timestamp
  completedAt: unknown; // Timestamp | null
  metadata: Record<string, unknown>;
}

export interface Lock {
  lockType: 'file' | 'table' | 'api_endpoint' | 'domain';
  resource: string;
  lockedBy: string;
  surfaceId: string;
  ownerId: string;
  lockedAt: unknown; // Timestamp
  expiresAt: unknown; // Timestamp
}

export interface Device {
  ownerId: string;
  platform: 'web' | 'ios' | 'android';
  fcmTopic: string;
  createdAt: unknown; // Timestamp
  updatedAt: unknown; // Timestamp
}

// === Risk Level ===

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// === Agent Names ===

export const AGENT_NAMES = [
  'claude-code',
  'cowork-desktop',
  'openai-codex',
  'chatgpt',
  'antigravity-ide',
  'excel-claude',
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

// === API Request Types ===

export interface SubmitApprovalRequest {
  agentName: string;
  surfaceId?: string;
  taskId?: string;
  title: string;
  description?: string;
  diffPayload?: DiffPayload;
  riskLevel?: RiskLevel;
  requiresApprovalBefore?: 'commit' | 'deploy' | 'execute' | 'publish';
  expiresAt?: string;
}

export interface DecideRequest {
  approvalId: string;
  decision: 'approved' | 'rejected' | 'modified';
  decisionNote?: string;
  modifications?: {
    instructions?: string;
    revisedDiff?: Record<string, unknown>;
  };
}

export interface BatchDecideRequest {
  decisions: {
    approvalId: string;
    decision: 'approved' | 'rejected' | 'modified';
    decisionNote?: string;
  }[];
}

export interface RegisterAgentRequest {
  name: string;
  type: 'terminal' | 'desktop' | 'browser' | 'mobile' | 'ide';
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

export interface HeartbeatRequest {
  surfaceId: string;
  status: 'active' | 'busy' | 'idle';
  currentTasks?: string[];
  load?: {
    cpuPercent?: number;
    memoryPercent?: number;
    queueDepth?: number;
  };
}

export interface QueryMemoryRequest {
  domain: string;
  keyPattern?: string;
  limit?: number;
  minConfidence?: number;
  createdBy?: string;
}

export interface WriteMemoryRequest {
  surfaceId: string;
  domain: string;
  key: string;
  value: Record<string, unknown>;
  confidence?: number;
  sourceApprovalId?: string;
}

export interface AssignTaskRequest {
  taskId?: string;
  title: string;
  description?: string;
  assignedSurface: string;
  priority?: number;
  parentTaskId?: string;
  dependsOn?: string[];
  metadata?: Record<string, unknown>;
}

export interface CompleteTaskRequest {
  taskId: string;
  surfaceId: string;
  outcome: 'success' | 'failure' | 'partial';
  output?: Record<string, unknown>;
  durationMs?: number;
  memoryEntries?: {
    domain: string;
    key: string;
    value: Record<string, unknown>;
    confidence: number;
  }[];
}

export interface LockResourceRequest {
  surfaceId: string;
  resourceType: 'file' | 'table' | 'api_endpoint' | 'domain';
  resourcePath: string;
  durationMinutes?: number;
}

export interface UnlockResourceRequest {
  lockId: string;
  surfaceId: string;
}

export interface ConflictReportRequest {
  reportingAgent: string;
  conflictType: 'file_collision' | 'semantic_contradiction' | 'duplicate_task';
  resource: string;
  otherAgent: string;
  details: string;
  suggestedResolution?: string;
}

// === API Response Types ===

export interface SubmitApprovalResponse {
  approvalId: string;
  status: 'pending';
  queuePosition: number;
  createdAt: string;
}

export interface DecideResponse {
  approvalId: string;
  status: string;
  decidedAt: string;
  agentNotified: boolean;
}

export interface BatchDecideResponse {
  processed: number;
  results: {
    approvalId: string;
    status: string;
    error?: string;
  }[];
}
