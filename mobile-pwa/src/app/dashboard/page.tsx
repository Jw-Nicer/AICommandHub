'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useApprovalQueue, useSurfaces, useTasks } from '@/lib/realtime';
import { getDashboard } from '@/lib/api';
import AgentCard from '@/components/AgentCard';
import Link from 'next/link';

interface DashboardData {
  queue: { pendingCount: number };
  tasks: { inProgress: number; blocked: number };
  memory: { totalEntries: number };
  generatedAt: string;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: approvals } = useApprovalQueue(user?.uid ?? null);
  const { data: surfaces } = useSurfaces(user?.uid ?? null);
  const { data: tasks } = useTasks(user?.uid ?? null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  useEffect(() => {
    if (!user) return;
    getDashboard()
      .then((data) => setDashboard(data as DashboardData))
      .catch(() => {});
  }, [user]);

  const activeSurfaces = surfaces.filter((s) =>
    ['active', 'busy'].includes(s.status as string)
  );
  const pendingTasks = tasks.filter((t) =>
    ['pending', 'assigned'].includes(t.status as string)
  );
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
  const blockedTasks = tasks.filter((t) => t.status === 'blocked');
  const conflicts = approvals.filter((a) =>
    (a.title as string)?.startsWith('File conflict:') ||
    (a.title as string)?.startsWith('Memory conflict:') ||
    (a.title as string)?.startsWith('Conflict:')
  );

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-28">
      <h1 className="text-[20px] font-bold text-text-primary mb-4">Execution Dashboard</h1>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <MetricCard
          label="Pending Approvals"
          value={approvals.length}
          color="text-modify"
          href="/"
        />
        <MetricCard
          label="Active Agents"
          value={activeSurfaces.length}
          subtext={`of ${surfaces.length}`}
          color="text-approve"
          href="/agents"
        />
        <MetricCard
          label="Tasks In Progress"
          value={inProgressTasks.length}
          subtext={blockedTasks.length > 0 ? `${blockedTasks.length} blocked` : undefined}
          color="text-risk-medium"
          href="/tasks"
        />
        <MetricCard
          label="Conflicts"
          value={conflicts.length}
          color={conflicts.length > 0 ? 'text-reject' : 'text-approve'}
        />
      </div>

      {/* Memory Stats */}
      <div className="bg-bg-secondary rounded-card p-4 mb-6">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-secondary">Memory Entries</span>
          <Link href="/memory" className="text-[12px] text-modify">View all</Link>
        </div>
        <p className="text-[24px] font-bold text-text-primary mt-1">
          {dashboard?.memory.totalEntries ?? '...'}
        </p>
      </div>

      {/* Active Agents */}
      <h2 className="text-[16px] font-semibold text-text-primary mb-3">Agent Status</h2>
      {surfaces.length === 0 ? (
        <p className="text-[13px] text-text-secondary mb-4">No agents registered.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-6">
          {surfaces.map((surface) => (
            <AgentCard
              key={surface.id}
              name={surface.name as string}
              status={surface.status as string}
              currentTasks={(surface.currentTasks || []) as string[]}
              lastHeartbeat={(surface.lastHeartbeat as { toDate?: () => Date })?.toDate?.()?.toISOString() || null}
              type={surface.type as string}
            />
          ))}
        </div>
      )}

      {/* Active Work */}
      {inProgressTasks.length > 0 && (
        <>
          <h2 className="text-[16px] font-semibold text-text-primary mb-3">Active Work</h2>
          <div className="space-y-2 mb-6">
            {inProgressTasks.map((task) => (
              <div key={task.id} className="bg-bg-secondary rounded-lg p-3 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-risk-medium animate-pulse flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-text-primary truncate">{task.title as string}</p>
                  {task.assignedSurface && (
                    <p className="text-[11px] text-text-secondary">{task.assignedSurface as string}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Blocked Tasks */}
      {blockedTasks.length > 0 && (
        <>
          <h2 className="text-[16px] font-semibold text-text-primary mb-3 flex items-center gap-2">
            Blocked
            <span className="text-[12px] text-reject font-normal">({blockedTasks.length})</span>
          </h2>
          <div className="space-y-2 mb-6">
            {blockedTasks.map((task) => (
              <div key={task.id} className="bg-bg-secondary rounded-lg p-3 border border-reject/20">
                <p className="text-[13px] font-medium text-text-primary truncate">{task.title as string}</p>
                {task.dependsOn && (task.dependsOn as string[]).length > 0 && (
                  <p className="text-[11px] text-text-secondary mt-1">
                    Waiting on {(task.dependsOn as string[]).length} task(s)
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Pending Queue */}
      {pendingTasks.length > 0 && (
        <>
          <h2 className="text-[16px] font-semibold text-text-primary mb-3">Queued Tasks</h2>
          <div className="space-y-2">
            {pendingTasks.slice(0, 5).map((task) => (
              <div key={task.id} className="bg-bg-secondary rounded-lg p-3">
                <p className="text-[13px] text-text-primary truncate">{task.title as string}</p>
              </div>
            ))}
            {pendingTasks.length > 5 && (
              <Link href="/tasks" className="block text-center text-[12px] text-modify py-2">
                +{pendingTasks.length - 5} more
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtext,
  color,
  href,
}: {
  label: string;
  value: number;
  subtext?: string;
  color: string;
  href?: string;
}) {
  const content = (
    <div className="bg-bg-secondary rounded-card p-4">
      <p className="text-[12px] text-text-secondary mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`text-[28px] font-bold ${color}`}>{value}</span>
        {subtext && <span className="text-[12px] text-text-secondary">{subtext}</span>}
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}
