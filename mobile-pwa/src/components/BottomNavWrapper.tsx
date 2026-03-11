'use client';

import BottomNav from './BottomNav';
import { useAuth } from './AuthProvider';
import { useApprovalQueue } from '@/lib/realtime';

export default function BottomNavWrapper() {
  const { user } = useAuth();
  const { data } = useApprovalQueue(user?.uid ?? null);

  if (!user) return null;

  return <BottomNav pendingCount={data.length} />;
}
