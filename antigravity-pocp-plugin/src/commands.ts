import type { POCPPluginClient } from './pocp-client';

export class Commands {
  private client: POCPPluginClient;

  constructor(client: POCPPluginClient) {
    this.client = client;
  }

  async submitApproval(title: string, description: string): Promise<string> {
    const result = await this.client.submitApproval(
      title,
      description,
      { type: 'document', structuredData: { source: 'antigravity-ide' } },
      'medium'
    );
    return result.approvalId;
  }

  async queryMemory(domain: string, keyPattern?: string): Promise<unknown[]> {
    return this.client.queryMemory(domain, keyPattern);
  }

  async writeMemory(domain: string, key: string, value: Record<string, unknown>): Promise<void> {
    await this.client.post('writeMemory', {
      domain,
      key,
      value,
      confidence: 0.9,
      agentName: 'antigravity-ide',
    });
  }

  async lockFile(filePath: string): Promise<string> {
    const result = await this.client.lockResource(filePath, 60);
    return result.lockId;
  }

  async unlockFile(lockId: string): Promise<void> {
    await this.client.unlockResource(lockId);
  }
}
