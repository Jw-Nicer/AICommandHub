import type { DocumentData } from 'firebase/firestore';

interface TaskColumnProps {
  title: string;
  tasks: (DocumentData & { id: string })[];
  allTasks?: (DocumentData & { id: string })[];
  surfaceMap?: Record<string, string>; // surfaceId -> agent name
}

const priorityColors: Record<number, string> = {
  1: 'bg-risk-critical',
  2: 'bg-risk-high',
  3: 'bg-risk-medium',
  4: 'bg-approve',
  5: 'bg-text-secondary',
};

const priorityLabels: Record<number, string> = {
  1: 'Critical',
  2: 'High',
  3: 'Medium',
  4: 'Low',
  5: 'Backlog',
};

export default function TaskColumn({ title, tasks, allTasks, surfaceMap }: TaskColumnProps) {
  function getBlockedByNames(dependsOn: string[]): string[] {
    if (!allTasks || !dependsOn?.length) return [];
    return dependsOn
      .map((id) => {
        const t = allTasks.find((at) => at.id === id);
        return t ? (t.title as string) : id.slice(0, 6);
      });
  }

  function getBlocksNames(taskId: string): string[] {
    if (!allTasks) return [];
    return allTasks
      .filter((t) => (t.dependsOn as string[] || []).includes(taskId))
      .map((t) => t.title as string);
  }

  return (
    <div className="flex-shrink-0 w-64 bg-bg-secondary rounded-card p-3">
      <h3 className="text-[14px] font-semibold text-text-primary mb-3 flex items-center gap-2">
        {title}
        <span className="text-[12px] text-text-secondary font-normal">({tasks.length})</span>
      </h3>

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {tasks.map((task) => {
          const dependsOn = (task.dependsOn as string[]) || [];
          const blockedByNames = getBlockedByNames(dependsOn);
          const blocksNames = getBlocksNames(task.id);
          const agentName = surfaceMap && task.assignedSurface
            ? surfaceMap[task.assignedSurface as string]
            : null;

          return (
            <div
              key={task.id}
              className="bg-bg-primary rounded-lg p-3 shadow-sm"
            >
              <div className="flex items-start gap-2">
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${priorityColors[task.priority as number] || priorityColors[3]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-text-primary line-clamp-2">
                    {task.title as string}
                  </p>

                  <div className="flex items-center gap-2 mt-1">
                    {agentName && (
                      <span className="text-[10px] text-modify bg-modify/10 px-1.5 py-0.5 rounded">
                        {agentName}
                      </span>
                    )}
                    <span className="text-[10px] text-text-secondary">
                      {priorityLabels[task.priority as number] || 'Medium'}
                    </span>
                  </div>

                  {/* Dependency indicators */}
                  {blockedByNames.length > 0 && (
                    <p className="text-[10px] text-reject mt-1 truncate">
                      Blocked by: {blockedByNames.join(', ')}
                    </p>
                  )}
                  {blocksNames.length > 0 && (
                    <p className="text-[10px] text-risk-medium mt-0.5 truncate">
                      Blocks: {blocksNames.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {tasks.length === 0 && (
          <p className="text-[13px] text-text-secondary text-center py-4">No tasks</p>
        )}
      </div>
    </div>
  );
}
