export interface ConnectorConfig {
  firebaseConfig: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId: string;
  };
  cloudFunctionUrl: string;
  agentName: string;
  surfaceId?: string;
  heartbeatIntervalMs?: number;
  autoApproveLowRisk?: boolean;
}

export interface ApprovalRequest {
  agentName: string;
  title: string;
  description?: string;
  diffPayload?: DiffPayload;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  requiresApprovalBefore?: 'commit' | 'deploy' | 'execute' | 'publish';
  taskId?: string;
  expiresAt?: string;
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
  status: 'approved' | 'rejected' | 'modified';
  decisionNote?: string;
  modifications?: {
    instructions?: string;
    revisedDiff?: Record<string, unknown>;
  };
}

export interface MemoryEntry {
  domain: string;
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  createdBy?: string;
}

export interface HeartbeatResponse {
  surfaceId: string;
  status: string;
  heartbeatAt: string;
  pendingTasks: Record<string, unknown>[];
  pendingDecisions: ApprovalDecision[];
}
