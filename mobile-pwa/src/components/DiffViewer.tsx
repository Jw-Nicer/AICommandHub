'use client';

import { useState } from 'react';

interface DiffViewerProps {
  preview: string;
}

interface DiffFile {
  filename: string;
  lines: { type: 'add' | 'remove' | 'context' | 'header'; content: string }[];
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = raw.split('\n');
  let current: DiffFile | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('--- ') && line.startsWith('--- a/')) {
      continue;
    }
    if (line.startsWith('+++ ')) {
      const filename = line.replace('+++ b/', '').replace('+++ ', '');
      current = { filename, lines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (line.startsWith('@@')) {
      current.lines.push({ type: 'header', content: line });
    } else if (line.startsWith('+')) {
      current.lines.push({ type: 'add', content: line.slice(1) });
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'remove', content: line.slice(1) });
    } else {
      current.lines.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line });
    }
  }

  return files.length > 0 ? files : [{ filename: 'changes', lines: lines.map((l) => ({ type: 'context' as const, content: l })) }];
}

const lineColors = {
  add: 'bg-green-900/30 text-green-300',
  remove: 'bg-red-900/30 text-red-300',
  context: 'text-text-secondary',
  header: 'text-modify bg-modify/10',
};

export default function DiffViewer({ preview }: DiffViewerProps) {
  const files = parseDiff(preview);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3">
      {files.map((file) => (
        <div key={file.filename} className="rounded-lg overflow-hidden border border-bg-secondary">
          <button
            onClick={() => setCollapsed((p) => ({ ...p, [file.filename]: !p[file.filename] }))}
            className="w-full flex items-center justify-between px-3 py-2 bg-bg-secondary text-[13px] font-mono text-text-primary hover:bg-bg-secondary/80"
          >
            <span>{file.filename}</span>
            <span className="text-text-secondary">{collapsed[file.filename] ? '+' : '-'}</span>
          </button>
          {!collapsed[file.filename] && (
            <div className="overflow-x-auto">
              <pre className="text-[12px] font-mono leading-5">
                {file.lines.map((line, i) => (
                  <div key={i} className={`px-3 ${lineColors[line.type]}`}>
                    {line.content || '\u00A0'}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
