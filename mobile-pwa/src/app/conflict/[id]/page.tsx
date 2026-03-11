'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';
import ConflictCompare from '@/components/ConflictCompare';
import { writeMemory, submitDecision } from '@/lib/api';

export default function ConflictPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [approval, setApproval] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !user) return;
    getDoc(doc(db, 'approval_queue', id)).then((snap) => {
      if (snap.exists()) setApproval(snap.data());
      setLoading(false);
    });
  }, [id, user]);

  async function handleResolve(winner: 'left' | 'right' | 'custom', customValue?: string) {
    if (!approval) return;

    const data = approval.diffPayload?.structuredData;
    if (!data) return;

    try {
      let value: Record<string, unknown>;
      if (winner === 'custom' && customValue) {
        value = JSON.parse(customValue);
      } else if (winner === 'left') {
        value = data.existing as Record<string, unknown>;
      } else {
        value = data.proposed as Record<string, unknown>;
      }

      // Write the winning value
      const key = approval.title?.replace('Memory conflict: ', '').split('/') || [];
      if (key.length >= 2) {
        await writeMemory(key[0], key.slice(1).join('/'), value, 1.0);
      }

      // Approve the conflict resolution
      await submitDecision(id, 'approved', `Resolved: picked ${winner}`);
      router.push('/');
    } catch (err) {
      console.error('Resolution failed:', err);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-modify" />
      </div>
    );
  }

  if (!approval?.diffPayload?.structuredData) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8 text-center">
        <p className="text-text-secondary">Conflict not found</p>
        <button onClick={() => router.back()} className="mt-4 text-modify text-[14px]">Go back</button>
      </div>
    );
  }

  const data = approval.diffPayload.structuredData;

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <button onClick={() => router.back()} className="text-modify text-[14px] mb-4 block">
        &larr; Back
      </button>

      <h1 className="text-[20px] font-bold text-text-primary mb-4">{approval.title}</h1>
      <p className="text-[14px] text-text-secondary mb-6">{approval.description}</p>

      <ConflictCompare
        left={{
          agentName: 'Existing',
          value: data.existing as Record<string, unknown>,
          confidence: data.existingConfidence as number,
          timestamp: new Date().toISOString(),
        }}
        right={{
          agentName: 'Proposed',
          value: data.proposed as Record<string, unknown>,
          confidence: data.proposedConfidence as number,
          timestamp: new Date().toISOString(),
        }}
        onResolve={handleResolve}
      />
    </div>
  );
}
