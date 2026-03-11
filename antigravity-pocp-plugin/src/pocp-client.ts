import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

export interface PluginConfig {
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseProjectId: string;
  cloudFunctionUrl: string;
  agentEmail: string;
  agentPassword: string;
  surfaceId?: string;
}

export class POCPPluginClient {
  private auth;
  private db;
  private config: PluginConfig;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: PluginConfig) {
    this.config = config;
    const app = getApps().length === 0
      ? initializeApp({
          apiKey: config.firebaseApiKey,
          authDomain: config.firebaseAuthDomain,
          projectId: config.firebaseProjectId,
        })
      : getApp();
    this.auth = getAuth(app);
    this.db = getFirestore(app);
  }

  async authenticate(): Promise<void> {
    await signInWithEmailAndPassword(this.auth, this.config.agentEmail, this.config.agentPassword);
  }

  private async getHeaders(): Promise<Record<string, string>> {
    if (!this.auth.currentUser) await this.authenticate();
    const token = await this.auth.currentUser!.getIdToken();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  async post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const headers = await this.getHeaders();
    const res = await fetch(`${this.config.cloudFunctionUrl}/${endpoint}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error);
    return data as T;
  }

  async submitApproval(
    title: string,
    description: string,
    diffPayload: Record<string, unknown>,
    riskLevel: string
  ): Promise<{ approvalId: string }> {
    return this.post('submitApproval', {
      agentName: 'antigravity-ide',
      surfaceId: this.config.surfaceId,
      title, description, diffPayload, riskLevel,
      requiresApprovalBefore: 'execute',
    });
  }

  waitForDecision(approvalId: string): Promise<{ status: string; decisionNote?: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { unsub(); reject(new Error('Timeout')); }, 3600000);
      const unsub: Unsubscribe = onSnapshot(
        doc(this.db, 'approval_queue', approvalId),
        (snap) => {
          const data = snap.data();
          if (!data || data.status === 'pending') return;
          clearTimeout(timer); unsub();
          resolve({ status: data.status, decisionNote: data.decisionNote });
        },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  async lockResource(resourcePath: string, durationMinutes = 30): Promise<{ lockId: string }> {
    return this.post('lockResource', {
      surfaceId: this.config.surfaceId,
      resourceType: 'file', resourcePath, durationMinutes,
    });
  }

  async unlockResource(lockId: string): Promise<void> {
    await this.post('unlockResource', { lockId, surfaceId: this.config.surfaceId });
  }

  async queryMemory(domain: string, keyPattern?: string): Promise<unknown[]> {
    const result = await this.post<{ entries: unknown[] }>('queryMemory', { domain, keyPattern });
    return result.entries;
  }

  startHeartbeat(intervalMs = 60000): void {
    this.stopHeartbeat();
    const tick = () => this.post('heartbeat', {
      surfaceId: this.config.surfaceId, status: 'active', currentTasks: [],
    }).catch(() => {});
    tick();
    this.heartbeatTimer = setInterval(tick, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  disconnect(): void { this.stopHeartbeat(); }
}
