import type { POCPPluginClient } from './pocp-client';

export interface StatusBarItem {
  text: string;
  color: string;
  tooltip: string;
}

export class StatusBar {
  private client: POCPPluginClient;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onUpdate: (item: StatusBarItem) => void;

  constructor(client: POCPPluginClient, onUpdate: (item: StatusBarItem) => void) {
    this.client = client;
    this.onUpdate = onUpdate;
  }

  start(intervalMs = 30000): void {
    this.stop();
    this.refresh();
    this.pollTimer = setInterval(() => this.refresh(), intervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async refresh(): Promise<void> {
    try {
      const dashboard = await this.client.post<{
        queue: { pendingCount: number };
      }>('getDashboard', {});

      // GET endpoint workaround: getDashboard is GET but we're using post helper
      // In production, this would use a GET request
      const pending = dashboard?.queue?.pendingCount || 0;

      if (pending > 0) {
        this.onUpdate({
          text: `POCP: ${pending} pending`,
          color: '#F59E0B', // amber
          tooltip: `${pending} approval(s) waiting for review`,
        });
      } else {
        this.onUpdate({
          text: 'POCP: Connected',
          color: '#10B981', // green
          tooltip: 'All clear — no pending approvals',
        });
      }
    } catch {
      this.onUpdate({
        text: 'POCP: Offline',
        color: '#EF4444', // red
        tooltip: 'Cannot reach POCP control plane',
      });
    }
  }
}
