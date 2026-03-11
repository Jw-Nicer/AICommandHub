'use client';

import { useState } from 'react';

interface Side {
  agentName: string;
  value: Record<string, unknown>;
  confidence: number;
  timestamp: string;
}

interface ConflictCompareProps {
  left: Side;
  right: Side;
  onResolve: (winner: 'left' | 'right' | 'custom', customValue?: string) => void;
}

export default function ConflictCompare({ left, right, onResolve }: ConflictCompareProps) {
  const [customValue, setCustomValue] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          { side: left, label: 'Left', key: 'left' as const },
          { side: right, label: 'Right', key: 'right' as const },
        ].map(({ side, label, key }) => (
          <div key={key} className="bg-bg-secondary rounded-card p-4">
            <div className="text-[12px] text-modify font-medium mb-2">{side.agentName}</div>
            <pre className="text-[12px] font-mono text-text-primary whitespace-pre-wrap break-all mb-2">
              {JSON.stringify(side.value, null, 2)}
            </pre>
            <div className="text-[11px] text-text-secondary space-y-1">
              <p>Confidence: {Math.round(side.confidence * 100)}%</p>
              <p>{new Date(side.timestamp).toLocaleString()}</p>
            </div>
            <button
              onClick={() => onResolve(key)}
              className="mt-3 w-full py-2 rounded-lg bg-approve text-white text-[13px] font-medium"
            >
              Pick {label}
            </button>
          </div>
        ))}
      </div>

      {showCustom ? (
        <div className="space-y-2">
          <textarea
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder="Enter custom resolution value (JSON)"
            className="w-full px-3 py-2 rounded-lg bg-bg-secondary text-text-primary text-[13px] font-mono border border-bg-secondary outline-none focus:border-modify min-h-[100px]"
          />
          <div className="flex gap-2">
            <button
              onClick={() => onResolve('custom', customValue)}
              className="flex-1 py-2 rounded-lg bg-modify text-white text-[13px] font-medium"
            >
              Apply Custom
            </button>
            <button
              onClick={() => setShowCustom(false)}
              className="px-4 py-2 rounded-lg text-text-secondary text-[13px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCustom(true)}
          className="w-full py-2 rounded-lg border border-modify text-modify text-[13px] font-medium"
        >
          Custom Resolution
        </button>
      )}
    </div>
  );
}
