import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  onSnapshot,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  ConnectorConfig,
  ApprovalRequest,
  ApprovalDecision,
  HeartbeatResponse,
  MemoryEntry,
} from './types';

export class POCPClient {
  private app: FirebaseApp;
  private auth: Auth;
  private db: Firestore;
  private config: ConnectorConfig;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private surfaceId: string | null;

  constructor(config: ConnectorConfig) {
    this.config = config;
    this.app = initializeApp(config.firebaseConfig, `pocp-${config.agentName}`);
    this.auth = getAuth(this.app);
    this.db = getFirestore(this.app);
    this.surfaceId = config.surfaceId || null;
  }

  async authenticate(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    const token = await user.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.config.cloudFunctionUrl}/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    return data as T;
  }

  async register(): Promise<string> {
    const result = await this.post<{ surfaceId: string }>('registerAgent', {
      name: this.config.agentName,
      type: 'terminal',
      capabilities: ['code', 'files'],
    });
    this.surfaceId = result.surfaceId;
    return result.surfaceId;
  }

  async submitApproval(request: ApprovalRequest): Promise<{ approvalId: string; status: string }> {
    return this.post('submitApproval', {
      ...request,
      agentName: request.agentName || this.config.agentName,
      surfaceId: this.surfaceId,
    });
  }

  waitForDecision(approvalId: string, timeoutMs = 3600000): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error('Decision timeout'));
      }, timeoutMs);

      const unsubscribe: Unsubscribe = onSnapshot(
        doc(this.db, 'approval_queue', approvalId),
        (snap) => {
          const data = snap.data();
          if (!data || data.status === 'pending') return;

          clearTimeout(timer);
          unsubscribe();
          resolve({
            approvalId,
            status: data.status,
            decisionNote: data.decisionNote,
            modifications: data.modifications,
          });
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  async queryMemory(domain: string, keyPattern?: string): Promise<MemoryEntry[]> {
    const result = await this.post<{ entries: MemoryEntry[] }>('queryMemory', {
      domain,
      keyPattern,
    });
    return result.entries;
  }

  async writeMemory(entry: MemoryEntry): Promise<{ memoryId: string; conflictDetected: boolean }> {
    return this.post('writeMemory', {
      surfaceId: this.surfaceId,
      domain: entry.domain,
      key: entry.key,
      value: entry.value,
      confidence: entry.confidence,
      agentName: this.config.agentName,
    });
  }

  async sendHeartbeat(): Promise<HeartbeatResponse> {
    return this.post('heartbeat', {
      surfaceId: this.surfaceId,
      status: 'active',
      currentTasks: [],
    });
  }

  startHeartbeat(intervalMs?: number): void {
    const interval = intervalMs || this.config.heartbeatIntervalMs || 60000;
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch((err) => console.error('Heartbeat failed:', err));
    }, interval);
    // Send first heartbeat immediately
    this.sendHeartbeat().catch((err) => console.error('Initial heartbeat failed:', err));
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async lockResource(resourcePath: string, durationMinutes = 30): Promise<{ lockId: string }> {
    return this.post('lockResource', {
      surfaceId: this.surfaceId,
      resourceType: 'file',
      resourcePath,
      durationMinutes,
    });
  }

  async unlockResource(lockId: string): Promise<void> {
    await this.post('unlockResource', {
      lockId,
      surfaceId: this.surfaceId,
    });
  }

  async completeTask(
    taskId: string,
    outcome: 'success' | 'failure' | 'partial',
    output?: Record<string, unknown>,
    memoryEntries?: MemoryEntry[]
  ): Promise<{ unblockedTaskIds: string[] }> {
    return this.post('completeTask', {
      taskId,
      surfaceId: this.surfaceId,
      outcome,
      output,
      memoryEntries,
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
  }
}
