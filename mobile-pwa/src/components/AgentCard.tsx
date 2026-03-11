interface AgentCardProps {
  name: string;
  status: string;
  currentTasks: string[];
  lastHeartbeat: string | null;
  type: string;
}

const statusColors: Record<string, string> = {
  active: 'border-approve bg-approve/20',
  busy: 'border-risk-medium bg-risk-medium/20',
  idle: 'border-text-secondary bg-text-secondary/20',
  inactive: 'border-reject bg-reject/20',
};

export default function AgentCard({ name, status, currentTasks, lastHeartbeat, type }: AgentCardProps) {
  const heartbeatText = lastHeartbeat
    ? getRelativeTime(new Date(lastHeartbeat))
    : 'never';

  return (
    <div className="bg-bg-secondary rounded-card p-4 shadow-[var(--card-shadow)]">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-3 h-3 rounded-full border-2 ${statusColors[status] || statusColors.inactive}`} />
        <div>
          <h4 className="text-[14px] font-medium text-text-primary">{name}</h4>
          <span className="text-[11px] text-text-secondary">{type}</span>
        </div>
      </div>

      <div className="text-[13px] text-text-secondary space-y-1">
        <p>Status: <span className="text-text-primary capitalize">{status}</span></p>
        {currentTasks.length > 0 && (
          <p className="truncate">Task: {currentTasks[0]}</p>
        )}
        <p>Heartbeat: {heartbeatText}</p>
      </div>
    </div>
  );
}

function getRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
