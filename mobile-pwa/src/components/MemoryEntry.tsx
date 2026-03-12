interface MemoryEntryProps {
  memoryId: string;
  domain: string;
  entryKey: string;
  value: Record<string, unknown>;
  confidence: number;
  createdBy: string;
  updatedAt: string | null;
}

export default function MemoryEntry({
  domain,
  entryKey,
  value,
  confidence,
  createdBy,
  updatedAt,
}: MemoryEntryProps) {
  const valueSummary = JSON.stringify(value).slice(0, 120);

  return (
    <div className="bg-bg-secondary rounded-card p-4 shadow-[var(--card-shadow)] mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] text-modify font-mono">{domain}/{entryKey}</span>
        <span className="text-[11px] text-text-secondary">
          {Math.round(confidence * 100)}%
        </span>
      </div>

      <p className="text-[13px] text-text-primary font-mono truncate mb-2">
        {valueSummary}
      </p>

      <div className="flex items-center justify-between text-[11px] text-text-secondary">
        <span>by {createdBy}</span>
        {updatedAt && <span>{new Date(updatedAt).toLocaleDateString()}</span>}
      </div>
    </div>
  );
}
