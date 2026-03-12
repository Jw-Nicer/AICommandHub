'use client';

import { useAuth } from '@/components/AuthProvider';
import { useSurfaces } from '@/lib/realtime';
import AgentCard from '@/components/AgentCard';

export default function AgentsPage() {
  const { user } = useAuth();
  const { data: surfaces, loading } = useSurfaces(user?.uid ?? null);

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <h1 className="text-[20px] font-bold text-text-primary mb-4">Agent Dashboard</h1>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-modify" />
        </div>
      ) : surfaces.length === 0 ? (
        <p className="text-center py-12 text-text-secondary">No agents registered yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {surfaces.map((surface) => (
            <AgentCard
              key={surface.id}
              name={surface.name}
              status={surface.status}
              currentTasks={surface.currentTasks || []}
              lastHeartbeat={surface.lastHeartbeat?.toDate?.()?.toISOString() || null}
              type={surface.type}
            />
          ))}
        </div>
      )}
    </div>
  );
}
