'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useApprovalQueue } from '@/lib/realtime';
import { batchDecide } from '@/lib/api';
import RiskBadge from '@/components/RiskBadge';
import type { DocumentData } from 'firebase/firestore';

interface ApprovalGroup {
  key: string;
  label: string;
  approvals: (DocumentData & { id: string })[];
}

function groupApprovals(approvals: (DocumentData & { id: string })[]): ApprovalGroup[] {
  // Only batch low and medium risk
  const batchable = approvals.filter((a) =>
    a.riskLevel === 'low' || a.riskLevel === 'medium'
  );

  // Group by agent
  const byAgent: Record<string, (DocumentData & { id: string })[]> = {};
  for (const a of batchable) {
    const agent = a.agentName as string;
    if (!byAgent[agent]) byAgent[agent] = [];
    byAgent[agent].push(a);
  }

  const groups: ApprovalGroup[] = [];

  for (const [agent, items] of Object.entries(byAgent)) {
    if (items.length === 1) {
      // Single item — try to group by file overlap instead
      groups.push({
        key: `single-${items[0].id}`,
        label: agent,
        approvals: items,
      });
      continue;
    }

    // Try to sub-group by overlapping files
    const withFiles = items.filter((a) =>
      (a.diffPayload as Record<string, unknown>)?.structuredData &&
      ((a.diffPayload as Record<string, unknown>).structuredData as Record<string, unknown>)?.filePaths
    );
    const withoutFiles = items.filter((a) => !withFiles.includes(a));

    if (withFiles.length > 1) {
      // Group items that share file paths
      const fileGroups = clusterByOverlap(withFiles);
      for (const fg of fileGroups) {
        const sharedFiles = getSharedFiles(fg);
        groups.push({
          key: `${agent}-files-${sharedFiles[0] || 'misc'}`,
          label: sharedFiles.length > 0
            ? `${agent} — ${sharedFiles[0]}${sharedFiles.length > 1 ? ` +${sharedFiles.length - 1}` : ''}`
            : agent,
          approvals: fg,
        });
      }
    } else if (withFiles.length === 1) {
      withoutFiles.push(withFiles[0]);
    }

    if (withoutFiles.length > 0) {
      groups.push({
        key: `${agent}-other`,
        label: `${agent} — other`,
        approvals: withoutFiles,
      });
    }
  }

  return groups;
}

function clusterByOverlap(items: (DocumentData & { id: string })[]): (DocumentData & { id: string })[][] {
  // Simple clustering: items that share any file go together
  const clusters: (DocumentData & { id: string })[][] = [];
  const assigned = new Set<string>();

  for (const item of items) {
    if (assigned.has(item.id)) continue;

    const cluster = [item];
    assigned.add(item.id);
    const itemFiles = getFilePaths(item);

    for (const other of items) {
      if (assigned.has(other.id)) continue;
      const otherFiles = getFilePaths(other);
      if (itemFiles.some((f) => otherFiles.includes(f))) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function getFilePaths(a: DocumentData): string[] {
  const sd = (a.diffPayload as Record<string, unknown>)?.structuredData as Record<string, unknown> | undefined;
  return (sd?.filePaths as string[]) || [];
}

function getSharedFiles(items: DocumentData[]): string[] {
  if (items.length < 2) return getFilePaths(items[0]);
  const first = new Set(getFilePaths(items[0]));
  return getFilePaths(items[1]).filter((f) => first.has(f));
}

export default function BatchPage() {
  const { user } = useAuth();
  const { data: approvals, loading } = useApprovalQueue(user?.uid ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState(false);
  const router = useRouter();

  const groups = useMemo(() => groupApprovals(approvals), [approvals]);
  const totalBatchable = groups.reduce((sum, g) => sum + g.approvals.length, 0);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(group: ApprovalGroup) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = group.approvals.every((a) => next.has(a.id));
      if (allSelected) {
        group.approvals.forEach((a) => next.delete(a.id));
      } else {
        group.approvals.forEach((a) => next.add(a.id));
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(groups.flatMap((g) => g.approvals.map((a) => a.id))));
  }

  async function handleBatchApprove() {
    if (selected.size === 0) return;
    setActing(true);
    try {
      await batchDecide(
        Array.from(selected).map((approvalId) => ({
          approvalId,
          decision: 'approved',
        }))
      );
      router.push('/');
    } catch (err) {
      console.error('Batch approve failed:', err);
    }
    setActing(false);
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-28">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[20px] font-bold text-text-primary">Smart Batch</h1>
        <button onClick={() => router.back()} className="text-[14px] text-modify">
          Cancel
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-modify" />
        </div>
      ) : totalBatchable === 0 ? (
        <p className="text-center py-12 text-text-secondary">No batchable approvals (low/medium risk only).</p>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] text-text-secondary">
              {selected.size} of {totalBatchable} selected
            </span>
            <button onClick={selectAll} className="text-[13px] text-modify">
              Select all
            </button>
          </div>

          <div className="space-y-4 mb-20">
            {groups.map((group) => {
              const groupAllSelected = group.approvals.every((a) => selected.has(a.id));

              return (
                <div key={group.key}>
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(group)}
                    className="flex items-center gap-2 mb-2 w-full text-left"
                  >
                    <input
                      type="checkbox"
                      checked={groupAllSelected}
                      readOnly
                      className="w-4 h-4 rounded accent-modify"
                    />
                    <span className="text-[13px] font-semibold text-text-primary flex-1">
                      {group.label}
                    </span>
                    <span className="text-[11px] text-text-secondary">
                      {group.approvals.length} item{group.approvals.length > 1 ? 's' : ''}
                    </span>
                  </button>

                  {/* Group items */}
                  <div className="space-y-1.5 ml-6">
                    {group.approvals.map((approval) => (
                      <label
                        key={approval.id}
                        className="flex items-center gap-3 bg-bg-secondary rounded-lg p-3 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(approval.id)}
                          onChange={() => toggleSelect(approval.id)}
                          className="w-4 h-4 rounded accent-approve"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <RiskBadge level={approval.riskLevel} />
                            {approval.riskClassification?.score !== undefined && (
                              <span className="text-[10px] text-text-secondary">
                                score: {approval.riskClassification.score}
                              </span>
                            )}
                          </div>
                          <p className="text-[13px] text-text-primary truncate">{approval.title}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="fixed bottom-16 left-0 right-0 bg-bg-primary border-t border-bg-secondary p-4">
            <div className="max-w-lg mx-auto">
              <button
                onClick={handleBatchApprove}
                disabled={acting || selected.size === 0}
                className="w-full py-3 rounded-lg bg-approve text-white text-[15px] font-medium disabled:opacity-50"
              >
                Approve {selected.size} Selected
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
