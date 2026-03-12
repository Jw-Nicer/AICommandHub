'use client';

import { useOnlineStatus } from '@/lib/offline';

export default function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-risk-medium text-white text-center text-[13px] py-2 px-4 font-medium">
      You&apos;re offline. Decisions will sync when you reconnect.
    </div>
  );
}
