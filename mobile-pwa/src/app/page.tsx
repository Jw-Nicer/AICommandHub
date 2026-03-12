'use client';

import { useAuth } from '@/components/AuthProvider';
import { useApprovalQueue } from '@/lib/realtime';
import ApprovalCard from '@/components/ApprovalCard';
import Link from 'next/link';

export default function QueuePage() {
  const { user } = useAuth();
  const { data: approvals, loading } = useApprovalQueue(user?.uid ?? null);

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[20px] font-bold text-text-primary">Approval Queue</h1>
        <div className="flex gap-2">
          {approvals.length > 1 && (
            <Link
              href="/batch"
              className="text-[13px] text-modify font-medium px-3 py-1.5 rounded-lg border border-modify"
            >
              Batch
            </Link>
          )}
          <Link
            href="/settings"
            className="text-[13px] text-text-secondary px-3 py-1.5 rounded-lg border border-bg-secondary"
          >
            Settings
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-modify" />
        </div>
      ) : approvals.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-[48px] mb-4">&#10003;</div>
          <p className="text-[16px] text-text-secondary">All clear! No pending approvals.</p>
        </div>
      ) : (
        <div>
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              id={approval.id}
              agentName={approval.agentName}
              title={approval.title}
              riskLevel={approval.riskLevel}
              requestedAt={approval.requestedAt}
              diffPayload={approval.diffPayload}
            />
          ))}
        </div>
      )}
    </div>
  );
}
