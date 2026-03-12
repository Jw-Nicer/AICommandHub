import { createPatch } from 'diff';
import type { POCPPluginClient } from './pocp-client';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

const CRITICAL_FILE_PATTERNS = [/\.env/, /secret/i, /password/i, /credential/i, /api[_-]?key/i];
const HIGH_FILE_PATTERNS = [/migration/i, /schema/i, /\.sql$/, /Dockerfile/, /docker-compose/];

export function assessFileRisk(filePath: string, linesChanged: number, content: string): RiskLevel {
  if (CRITICAL_FILE_PATTERNS.some((p) => p.test(filePath) || p.test(content))) return 'critical';
  if (HIGH_FILE_PATTERNS.some((p) => p.test(filePath))) return 'high';
  if (linesChanged < 10) return 'low';
  return 'medium';
}

export class FileWatcher {
  private snapshots: Map<string, string> = new Map();
  private client: POCPPluginClient;
  private minLinesThreshold: number;

  constructor(client: POCPPluginClient, minLinesThreshold = 5) {
    this.client = client;
    this.minLinesThreshold = minLinesThreshold;
  }

  onFileOpen(filePath: string, content: string): void {
    this.snapshots.set(filePath, content);
  }

  async onFileSave(filePath: string, newContent: string): Promise<void> {
    const oldContent = this.snapshots.get(filePath);
    if (!oldContent) {
      this.snapshots.set(filePath, newContent);
      return;
    }

    // Compute diff
    const patch = createPatch(filePath, oldContent, newContent);
    const addedLines = (patch.match(/^\+[^+]/gm) || []).length;
    const removedLines = (patch.match(/^-[^-]/gm) || []).length;
    const totalChanged = addedLines + removedLines;

    // Skip if changes are too small
    if (totalChanged < this.minLinesThreshold) {
      this.snapshots.set(filePath, newContent);
      return;
    }

    const risk = assessFileRisk(filePath, totalChanged, newContent);
    const fileName = filePath.split(/[/\\]/).pop() || filePath;

    try {
      // Acquire lock
      let lockId: string | null = null;
      try {
        const lock = await this.client.lockResource(filePath, 30);
        lockId = lock.lockId;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('resource_locked')) {
          console.log(`POCP: ${filePath} is locked by another agent`);
          return;
        }
      }

      // Submit approval
      const result = await this.client.submitApproval(
        `File change: ${fileName}`,
        `${addedLines} lines added, ${removedLines} lines removed`,
        {
          type: 'file_change',
          filesChanged: 1,
          insertions: addedLines,
          deletions: removedLines,
          preview: patch.slice(0, 5000),
          structuredData: {
            filePaths: [filePath],
            changeType: 'modify',
          },
        },
        risk
      );

      console.log(`POCP: Submitted approval ${result.approvalId} for ${fileName} (${risk} risk)`);

      // Release lock
      if (lockId) {
        await this.client.unlockResource(lockId).catch(() => {});
      }
    } catch (err) {
      console.error('POCP: Failed to submit file change:', err);
    }

    // Update snapshot
    this.snapshots.set(filePath, newContent);
  }

  removeFile(filePath: string): void {
    this.snapshots.delete(filePath);
  }
}
