'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import RiskBadge from './RiskBadge';
import { submitDecision } from '@/lib/api';

interface ApprovalCardProps {
  id: string;
  agentName: string;
  title: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requestedAt: { toDate?: () => Date } | null;
  diffPayload?: {
    type?: string;
    filesChanged?: number;
    insertions?: number;
    deletions?: number;
    structuredData?: Record<string, unknown>;
  };
}

export default function ApprovalCard({
  id,
  agentName,
  title,
  riskLevel,
  requestedAt,
  diffPayload,
}: ApprovalCardProps) {
  const router = useRouter();
  const [acting, setActing] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const isConflict = title.startsWith('Memory conflict:');

  const timeAgo = requestedAt?.toDate
    ? getRelativeTime(requestedAt.toDate())
    : '';

  async function handleApprove(e: React.MouseEvent) {
    e.stopPropagation();
    setActing(true);
    try {
      await submitDecision(id, 'approved');
    } catch (err) {
      console.error('Approve failed:', err);
    }
    setActing(false);
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setActing(true);
    try {
      await submitDecision(id, 'rejected', rejectNote || undefined);
    } catch (err) {
      console.error('Reject failed:', err);
    }
    setActing(false);
    setShowRejectInput(false);
  }

  return (
    <div
      onClick={() => router.push(isConflict ? `/conflict/${id}` : `/approval/${id}`)}
      className="bg-bg-secondary rounded-card p-[var(--card-padding)] shadow-[var(--card-shadow)] cursor-pointer transition-transform active:scale-[0.98] mb-3"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-modify">{agentName}</span>
          <RiskBadge level={riskLevel} />
          {isConflict && (
            <span className="text-[10px] font-bold text-orange-400 bg-orange-400/10 px-1.5 py-0.5 rounded uppercase">
              conflict
            </span>
          )}
        </div>
        <span className="text-[12px] text-text-secondary">{timeAgo}</span>
      </div>

      <h3 className="text-[16px] font-medium text-text-primary line-clamp-2 mb-2">
        {title}
      </h3>

      {diffPayload && (diffPayload.filesChanged || diffPayload.insertions || diffPayload.deletions) && (
        <p className="text-[13px] text-text-secondary mb-3">
          {diffPayload.filesChanged ? `${diffPayload.filesChanged} files` : ''}
          {diffPayload.insertions ? ` +${diffPayload.insertions}` : ''}
          {diffPayload.deletions ? ` -${diffPayload.deletions}` : ''}
        </p>
      )}

      {showRejectInput ? (
        <form onSubmit={handleReject} onClick={(e) => e.stopPropagation()} className="flex gap-2">
          <input
            type="text"
            placeholder="Reason (optional)"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-bg-primary text-text-primary text-[14px] border border-bg-secondary outline-none focus:border-modify"
            autoFocus
          />
          <button type="submit" disabled={acting} className="px-3 py-2 rounded-lg bg-reject text-white text-[14px] font-medium">
            Send
          </button>
          <button type="button" onClick={() => setShowRejectInput(false)} className="px-3 py-2 rounded-lg text-text-secondary text-[14px]">
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={handleApprove}
            disabled={acting}
            className="flex-1 py-2 rounded-lg bg-approve text-white text-[14px] font-medium transition-opacity disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => setShowRejectInput(true)}
            disabled={acting}
            className="flex-1 py-2 rounded-lg bg-reject text-white text-[14px] font-medium transition-opacity disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function getRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
