'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useMemory } from '@/lib/realtime';
import { deleteMemory } from '@/lib/api';

const DOMAINS = ['all', 'codebase', 'project', 'decision', 'context'] as const;

export default function MemoryPage() {
  const { user } = useAuth();
  const [domain, setDomain] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data: entries, loading } = useMemory(
    user?.uid ?? null,
    domain === 'all' ? undefined : domain
  );

  const filtered = search
    ? entries.filter((e) => (e.key as string)?.includes(search))
    : entries;

  async function handleDelete(memoryId: string) {
    if (deleting) return;
    setDeleting(memoryId);
    try {
      await deleteMemory(memoryId);
    } catch (err) {
      console.error('Delete failed:', err);
    }
    setDeleting(null);
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-28">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[20px] font-bold text-text-primary">Memory Explorer</h1>
        <span className="text-[12px] text-text-secondary">{filtered.length} entries</span>
      </div>

      <input
        type="text"
        placeholder="Filter by key..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-4 py-2.5 rounded-lg bg-bg-secondary text-text-primary text-[14px] border border-bg-secondary outline-none focus:border-modify mb-3"
      />

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {DOMAINS.map((d) => (
          <button
            key={d}
            onClick={() => setDomain(d)}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${
              domain === d
                ? 'bg-modify text-white'
                : 'bg-bg-secondary text-text-secondary'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-modify" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-12 text-text-secondary">No memory entries found.</p>
      ) : (
        filtered.map((entry) => (
          <div key={entry.id} className="bg-bg-secondary rounded-card p-4 shadow-[var(--card-shadow)] mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] text-modify font-mono">
                {entry.domain as string}/{entry.key as string}
              </span>
              <span className="text-[11px] text-text-secondary">
                {Math.round((entry.confidence as number) * 100)}%
              </span>
            </div>

            <p className="text-[13px] text-text-primary font-mono truncate mb-2">
              {JSON.stringify(entry.value).slice(0, 120)}
            </p>

            <div className="flex items-center justify-between">
              <div className="text-[11px] text-text-secondary">
                <span>by {entry.createdBy as string}</span>
                {entry.updatedAt && (
                  <span className="ml-2">
                    {(entry.updatedAt as { toDate?: () => Date })?.toDate
                      ? (entry.updatedAt as { toDate: () => Date }).toDate().toLocaleDateString()
                      : ''}
                  </span>
                )}
              </div>
              <button
                onClick={() => handleDelete(entry.id)}
                disabled={deleting === entry.id}
                className="text-[11px] text-reject opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30"
              >
                {deleting === entry.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
