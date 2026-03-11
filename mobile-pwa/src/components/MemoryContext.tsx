'use client';

import { useState, useEffect } from 'react';
import { queryMemory } from '@/lib/api';

interface MemoryContextProps {
  agentName: string;
  diffPayload?: {
    structuredData?: {
      filePaths?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

interface MemoryResult {
  memoryId: string;
  domain: string;
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  createdBy: string;
  updatedAt: string | null;
}

export default function MemoryContext({ agentName, diffPayload }: MemoryContextProps) {
  const [entries, setEntries] = useState<MemoryResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRelated() {
      try {
        const results: MemoryResult[] = [];
        const seen = new Set<string>();

        // Query memory by file paths in the diff
        const filePaths = diffPayload?.structuredData?.filePaths;
        if (Array.isArray(filePaths)) {
          for (const fp of filePaths.slice(0, 3)) {
            // Extract directory or module name as key prefix
            const parts = fp.split('/');
            const prefix = parts.length > 1 ? parts[parts.length - 2] : parts[0];
            const res = await queryMemory('codebase', prefix) as { entries: MemoryResult[] };
            for (const e of res.entries || []) {
              if (!seen.has(e.memoryId)) {
                seen.add(e.memoryId);
                results.push(e);
              }
            }
          }
        }

        // Also query decision domain for any related entries
        const res = await queryMemory('decision') as { entries: MemoryResult[] };
        for (const e of (res.entries || []).slice(0, 5)) {
          if (!seen.has(e.memoryId)) {
            seen.add(e.memoryId);
            results.push(e);
          }
        }

        setEntries(results.slice(0, 8));
      } catch {
        // Silently fail — context is supplementary
      } finally {
        setLoading(false);
      }
    }

    fetchRelated();
  }, [agentName, diffPayload]);

  if (loading) {
    return (
      <div className="mb-4">
        <h2 className="text-[14px] font-semibold text-text-primary mb-2">Related Memory</h2>
        <div className="animate-pulse bg-bg-secondary rounded-card h-16" />
      </div>
    );
  }

  if (entries.length === 0) return null;

  return (
    <div className="mb-4">
      <h2 className="text-[14px] font-semibold text-text-primary mb-2">Related Memory</h2>
      <div className="space-y-2">
        {entries.map((entry) => (
          <div key={entry.memoryId} className="bg-bg-secondary rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-modify font-mono">
                {entry.domain}/{entry.key}
              </span>
              <span className="text-[10px] text-text-secondary">
                {Math.round(entry.confidence * 100)}%
              </span>
            </div>
            <p className="text-[12px] text-text-primary font-mono truncate">
              {JSON.stringify(entry.value).slice(0, 100)}
            </p>
            <span className="text-[10px] text-text-secondary">by {entry.createdBy}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
