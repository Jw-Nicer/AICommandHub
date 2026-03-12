'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useTasks, useSurfaces } from '@/lib/realtime';
import { routeTask } from '@/lib/api';
import TaskColumn from '@/components/TaskColumn';

const COLUMNS = [
  { title: 'Pending', statuses: ['pending', 'assigned'] },
  { title: 'In Progress', statuses: ['in_progress'] },
  { title: 'Blocked', statuses: ['blocked'] },
  { title: 'Done', statuses: ['done'] },
];

const CAPABILITIES = ['code', 'files', 'data', 'research', 'deploy'] as const;

export default function TasksPage() {
  const { user } = useAuth();
  const { data: tasks, loading } = useTasks(user?.uid ?? null);
  const { data: surfaces } = useSurfaces(user?.uid ?? null);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [caps, setCaps] = useState<string[]>(['code']);
  const [priority, setPriority] = useState(3);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Build surfaceId → name map
  const surfaceMap: Record<string, string> = {};
  for (const s of surfaces) {
    surfaceMap[s.id] = s.name as string;
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true);
    setResult(null);
    try {
      const res = await routeTask(title, description, caps, priority) as {
        assignedTo?: { name: string; score: number } | null;
        taskId: string;
      };
      const assigned = res.assignedTo;
      setResult(
        assigned
          ? `Routed to ${assigned.name} (score: ${assigned.score})`
          : 'Created as unassigned (no matching agent available)'
      );
      setTitle('');
      setDescription('');
      setTimeout(() => {
        setShowCreate(false);
        setResult(null);
      }, 2000);
    } catch (err) {
      setResult(`Error: ${(err as Error).message}`);
    }
    setCreating(false);
  }

  return (
    <div className="px-4 pt-4 pb-28">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[20px] font-bold text-text-primary">Task Board</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-[13px] font-medium px-3 py-1.5 rounded-lg bg-modify text-white"
        >
          {showCreate ? 'Cancel' : 'New Task'}
        </button>
      </div>

      {/* Task Creation Form */}
      {showCreate && (
        <div className="bg-bg-secondary rounded-card p-4 mb-4">
          <input
            type="text"
            placeholder="Task title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-bg-primary text-text-primary text-[14px] border border-bg-secondary outline-none focus:border-modify mb-2"
            autoFocus
          />
          <textarea
            placeholder="Description (optional)..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-bg-primary text-text-primary text-[13px] border border-bg-secondary outline-none focus:border-modify mb-3 min-h-[60px]"
          />

          <div className="mb-3">
            <p className="text-[12px] text-text-secondary mb-1.5">Required capabilities</p>
            <div className="flex flex-wrap gap-1.5">
              {CAPABILITIES.map((c) => (
                <button
                  key={c}
                  onClick={() =>
                    setCaps((prev) =>
                      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                    )
                  }
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    caps.includes(c)
                      ? 'bg-modify text-white'
                      : 'bg-bg-primary text-text-secondary'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <span className="text-[12px] text-text-secondary">Priority</span>
            <select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="bg-bg-primary text-text-primary text-[13px] rounded-lg px-2 py-1 border border-bg-secondary outline-none"
            >
              <option value={1}>Critical</option>
              <option value={2}>High</option>
              <option value={3}>Medium</option>
              <option value={4}>Low</option>
              <option value={5}>Backlog</option>
            </select>
          </div>

          <button
            onClick={handleCreate}
            disabled={creating || !title.trim()}
            className="w-full py-2.5 rounded-lg bg-approve text-white text-[14px] font-medium disabled:opacity-50"
          >
            {creating ? 'Routing...' : 'Create & Auto-Route'}
          </button>

          {result && (
            <p className={`text-[12px] mt-2 text-center ${result.startsWith('Error') ? 'text-reject' : 'text-approve'}`}>
              {result}
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-modify" />
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <TaskColumn
              key={col.title}
              title={col.title}
              tasks={tasks.filter((t) => col.statuses.includes(t.status as string))}
              allTasks={tasks}
              surfaceMap={surfaceMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}
