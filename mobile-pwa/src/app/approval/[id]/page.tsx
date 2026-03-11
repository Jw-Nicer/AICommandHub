'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';
import RiskBadge from '@/components/RiskBadge';
import DiffViewer from '@/components/DiffViewer';
import MemoryContext from '@/components/MemoryContext';
import { submitDecision } from '@/lib/api';

export default function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [approval, setApproval] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [modifyText, setModifyText] = useState('');
  const [showModify, setShowModify] = useState(false);

  useEffect(() => {
    if (!id || !user) return;
    getDoc(doc(db, 'approval_queue', id)).then((snap) => {
      if (snap.exists()) setApproval(snap.data());
      setLoading(false);
    });
  }, [id, user]);

  async function handleDecision(decision: 'approved' | 'rejected' | 'modified') {
    setActing(true);
    try {
      await submitDecision(
        id,
        decision,
        undefined,
        decision === 'modified' ? { instructions: modifyText } : undefined
      );
      router.back();
    } catch (err) {
      console.error('Decision failed:', err);
    }
    setActing(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-modify" />
      </div>
    );
  }

  if (!approval) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8 text-center">
        <p className="text-text-secondary">Approval not found</p>
        <button onClick={() => router.back()} className="mt-4 text-modify text-[14px]">Go back</button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-28">
      <button onClick={() => router.back()} className="text-modify text-[14px] mb-4 block">
        &larr; Back to queue
      </button>

      <div className="flex items-center gap-3 mb-4">
        <span className="text-[14px] font-medium text-modify">{approval.agentName}</span>
        <RiskBadge level={approval.riskLevel} />
        <span className="text-[12px] text-text-secondary ml-auto">
          {approval.requestedAt?.toDate?.()?.toLocaleString() || ''}
        </span>
      </div>

      <h1 className="text-[20px] font-bold text-text-primary mb-3">{approval.title}</h1>

      {approval.description && (
        <p className="text-[14px] text-text-secondary mb-4">{approval.description}</p>
      )}

      {approval.diffPayload?.preview && (
        <div className="mb-4">
          <h2 className="text-[14px] font-semibold text-text-primary mb-2">Changes</h2>
          <DiffViewer preview={approval.diffPayload.preview} />
        </div>
      )}

      {approval.diffPayload && (
        <div className="text-[13px] text-text-secondary mb-6">
          {approval.diffPayload.filesChanged && <span>{approval.diffPayload.filesChanged} files changed</span>}
          {approval.diffPayload.insertions && <span className="text-approve ml-2">+{approval.diffPayload.insertions}</span>}
          {approval.diffPayload.deletions && <span className="text-reject ml-2">-{approval.diffPayload.deletions}</span>}
        </div>
      )}

      <MemoryContext agentName={approval.agentName} diffPayload={approval.diffPayload} />

      {approval.status === 'pending' && (
        <div className="fixed bottom-16 left-0 right-0 bg-bg-primary border-t border-bg-secondary p-4">
          <div className="max-w-lg mx-auto">
            {showModify ? (
              <div className="space-y-2">
                <textarea
                  value={modifyText}
                  onChange={(e) => setModifyText(e.target.value)}
                  placeholder="Modification instructions..."
                  className="w-full px-3 py-2 rounded-lg bg-bg-secondary text-text-primary text-[14px] border border-bg-secondary outline-none focus:border-modify min-h-[80px]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDecision('modified')}
                    disabled={acting || !modifyText.trim()}
                    className="flex-1 py-2.5 rounded-lg bg-modify text-white text-[14px] font-medium disabled:opacity-50"
                  >
                    Send Modifications
                  </button>
                  <button onClick={() => setShowModify(false)} className="px-4 py-2.5 text-text-secondary text-[14px]">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => handleDecision('approved')}
                  disabled={acting}
                  className="flex-1 py-2.5 rounded-lg bg-approve text-white text-[14px] font-medium disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDecision('rejected')}
                  disabled={acting}
                  className="flex-1 py-2.5 rounded-lg bg-reject text-white text-[14px] font-medium disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={() => setShowModify(true)}
                  disabled={acting}
                  className="flex-1 py-2.5 rounded-lg bg-modify text-white text-[14px] font-medium disabled:opacity-50"
                >
                  Modify
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
