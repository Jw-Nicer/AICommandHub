'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { signOut } from '@/lib/firebase';
import { useUserSettings } from '@/lib/realtime';
import { getRules, toggleRule, analyzePatterns, getDigests } from '@/lib/api';

interface Rule {
  ruleId: string;
  agentName: string;
  ruleType: string;
  confidence: number;
  reason: string;
  enabled: boolean;
}

interface Digest {
  id: string;
  weekStart: string;
  weekEnd: string;
  approvals: {
    total: number;
    approved: number;
    rejected: number;
    expired: number;
    autoApproved: number;
    avgResponseMs: number;
  };
  agentBreakdown: Record<string, number>;
  memoryEntriesCreated: number;
  tasksCompleted: number;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { settings, loading, updateSettings } = useUserSettings(user?.uid ?? null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!user) return;
    getRules()
      .then((r: unknown) => setRules((r as { rules: Rule[] }).rules || []))
      .catch(() => {});
    getDigests()
      .then((d: unknown) => setDigests((d as { digests: Digest[] }).digests || []))
      .catch(() => {});
  }, [user]);

  async function handleToggleRule(ruleId: string, enabled: boolean) {
    try {
      await toggleRule(ruleId, enabled);
      setRules((prev) =>
        prev.map((r) => (r.ruleId === ruleId ? { ...r, enabled } : r))
      );
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    try {
      await analyzePatterns();
      const r = await getRules() as { rules: Rule[] };
      setRules(r.rules || []);
    } catch (err) {
      console.error('Analysis failed:', err);
    }
    setAnalyzing(false);
  }

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-28">
      <h1 className="text-[20px] font-bold text-text-primary mb-6">Settings</h1>

      <div className="space-y-4">
        {/* Approval Settings */}
        <div className="bg-bg-secondary rounded-card p-4">
          <h2 className="text-[14px] font-semibold text-text-primary mb-3">Approvals</h2>
          <label className="flex items-center justify-between">
            <div>
              <span className="text-[14px] text-text-primary block">Auto-approve low risk</span>
              <span className="text-[11px] text-text-secondary">Instantly approve low-risk submissions</span>
            </div>
            <input
              type="checkbox"
              checked={settings.autoApproveLow}
              onChange={(e) => updateSettings({ autoApproveLow: e.target.checked })}
              disabled={loading}
              className="w-5 h-5 accent-approve"
            />
          </label>
        </div>

        {/* Notification Settings */}
        <div className="bg-bg-secondary rounded-card p-4">
          <h2 className="text-[14px] font-semibold text-text-primary mb-3">Notifications</h2>
          <label className="flex items-center justify-between">
            <span className="text-[14px] text-text-primary">Push notifications</span>
            <input
              type="checkbox"
              checked={settings.notificationsEnabled}
              onChange={(e) => updateSettings({ notificationsEnabled: e.target.checked })}
              disabled={loading}
              className="w-5 h-5 accent-modify"
            />
          </label>
        </div>

        {/* Auto-Approve Rules */}
        <div className="bg-bg-secondary rounded-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[14px] font-semibold text-text-primary">Auto-Approve Rules</h2>
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="text-[12px] text-modify font-medium disabled:opacity-50"
            >
              {analyzing ? 'Analyzing...' : 'Analyze Patterns'}
            </button>
          </div>

          {rules.length === 0 ? (
            <p className="text-[13px] text-text-secondary">
              No rules yet. Tap &quot;Analyze Patterns&quot; to scan your approval history.
            </p>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => (
                <div key={rule.ruleId} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => handleToggleRule(rule.ruleId, e.target.checked)}
                    className="w-4 h-4 accent-approve mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-text-primary">
                        {rule.agentName}
                      </span>
                      <span className="text-[10px] text-modify bg-modify/10 px-1.5 py-0.5 rounded">
                        {rule.ruleType.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-secondary mt-0.5">{rule.reason}</p>
                    <p className="text-[10px] text-text-secondary">
                      Confidence: {Math.round(rule.confidence * 100)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Weekly Digests */}
        {digests.length > 0 && (
          <div className="bg-bg-secondary rounded-card p-4">
            <h2 className="text-[14px] font-semibold text-text-primary mb-3">Weekly Digests</h2>
            <div className="space-y-3">
              {digests.map((digest) => (
                <div key={digest.id} className="border-b border-bg-primary pb-3 last:border-0 last:pb-0">
                  <p className="text-[12px] text-text-secondary mb-1">
                    {new Date(digest.weekStart).toLocaleDateString()} &mdash; {new Date(digest.weekEnd).toLocaleDateString()}
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[16px] font-bold text-approve">{digest.approvals.approved}</p>
                      <p className="text-[10px] text-text-secondary">Approved</p>
                    </div>
                    <div>
                      <p className="text-[16px] font-bold text-reject">{digest.approvals.rejected}</p>
                      <p className="text-[10px] text-text-secondary">Rejected</p>
                    </div>
                    <div>
                      <p className="text-[16px] font-bold text-modify">{digest.tasksCompleted}</p>
                      <p className="text-[10px] text-text-secondary">Tasks Done</p>
                    </div>
                  </div>
                  {digest.approvals.autoApproved > 0 && (
                    <p className="text-[10px] text-text-secondary mt-1 text-center">
                      {digest.approvals.autoApproved} auto-approved &middot; avg {Math.round(digest.approvals.avgResponseMs / 1000)}s response
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Account */}
        <div className="bg-bg-secondary rounded-card p-4">
          <h2 className="text-[14px] font-semibold text-text-primary mb-3">Account</h2>
          <p className="text-[13px] text-text-secondary mb-3">{user?.email}</p>
          <button
            onClick={handleSignOut}
            className="w-full py-2.5 rounded-lg bg-reject text-white text-[14px] font-medium"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
