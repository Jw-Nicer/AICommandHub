import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';

const githubToken = defineSecret('GITHUB_TOKEN');

const db = getFirestore();

function verifyGitHubSignature(req: any, secret: string): boolean {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

// POST /github-webhook — Receives GitHub PR events from Codex
export const githubWebhook = onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  // Verify webhook signature
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret && !verifyGitHubSignature(req, secret)) {
    res.status(401).json({ error: 'invalid_signature' });
    return;
  }

  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event !== 'pull_request') {
    res.status(200).json({ message: 'ignored', event });
    return;
  }

  if (payload.action !== 'opened' && payload.action !== 'synchronize') {
    res.status(200).json({ message: 'ignored', action: payload.action });
    return;
  }

  const pr = payload.pull_request;
  const repo = payload.repository;

  // Classify risk
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'medium';
  const totalChanges = (pr.additions || 0) + (pr.deletions || 0);

  if (pr.changed_files > 15 || totalChanges > 500) riskLevel = 'high';
  else if (pr.changed_files <= 2 && totalChanges <= 20) riskLevel = 'low';

  if (/deploy/i.test(pr.title) || /migration/i.test(pr.title)) riskLevel = 'critical';

  // Find the Codex surface for the repo owner
  // Since webhook doesn't carry a Firebase UID, we look up by agent name
  // The webhook must include a custom header or query param with the owner UID
  const ownerId = req.query.ownerId as string || req.headers['x-pocp-owner-id'] as string;
  if (!ownerId) {
    res.status(400).json({ error: 'missing_owner_id', message: 'Set ownerId query param or x-pocp-owner-id header' });
    return;
  }

  // Find codex surface
  let surfaceId: string | null = null;
  const surfaceSnap = await db.collection('surfaces')
    .where('name', '==', 'openai-codex')
    .where('ownerId', '==', ownerId)
    .limit(1).get();
  if (!surfaceSnap.empty) surfaceId = surfaceSnap.docs[0].id;

  const approvalRef = await db.collection('approval_queue').add({
    surfaceId,
    agentName: 'openai-codex',
    taskId: null,
    title: `PR #${pr.number}: ${pr.title}`,
    description: pr.body || '',
    diffPayload: {
      type: 'code_diff',
      filesChanged: pr.changed_files,
      insertions: pr.additions,
      deletions: pr.deletions,
      fullDiffUrl: pr.diff_url,
      structuredData: {
        prNumber: pr.number,
        prUrl: pr.html_url,
        branch: pr.head.ref,
        baseBranch: pr.base.ref,
        repo: repo.full_name,
        author: pr.user.login,
      },
    },
    riskLevel,
    requiresApprovalBefore: 'commit',
    status: 'pending',
    decisionNote: null,
    modifications: null,
    ownerId,
    requestedAt: FieldValue.serverTimestamp(),
    decidedAt: null,
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4h for PRs
  });

  res.status(201).json({
    approvalId: approvalRef.id,
    prNumber: pr.number,
    riskLevel,
    status: 'pending',
  });
});

// Trigger: Relay decision back to GitHub when Codex approval is decided
export const relayCodexDecision = onDocumentUpdated(
  {
    document: 'approval_queue/{approvalId}',
    secrets: [githubToken],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Only handle codex approvals that transition from pending
    if (after.agentName !== 'openai-codex') return;
    if (before.status !== 'pending' || after.status === 'pending') return;

    const prData = after.diffPayload?.structuredData;
    if (!prData?.prNumber || !prData?.repo) return;

    const token = githubToken.value();
    if (!token) {
      console.warn('GITHUB_TOKEN not configured — skipping GitHub API relay');
      return;
    }

    const apiBase = `https://api.github.com/repos/${prData.repo}/pulls/${prData.prNumber}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    try {
      if (after.status === 'approved') {
        // Merge the PR
        const res = await fetch(`${apiBase}/merge`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commit_title: `Merge PR #${prData.prNumber} (approved via POCP)`,
            merge_method: 'squash',
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          console.error(`GitHub merge failed (${res.status}):`, err);
        } else {
          console.log(`Merged PR #${prData.prNumber} on ${prData.repo}`);
        }
      } else if (after.status === 'rejected') {
        // Close the PR
        const res = await fetch(apiBase, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'closed' }),
        });
        if (!res.ok) {
          const err = await res.json();
          console.error(`GitHub close failed (${res.status}):`, err);
        } else {
          console.log(`Closed PR #${prData.prNumber} on ${prData.repo}`);
        }
      } else if (after.status === 'modified') {
        // Post a review comment with modification instructions
        const body = after.decisionNote
          || after.modifications?.instructions
          || 'Changes requested via POCP.';
        const res = await fetch(`${apiBase}/reviews`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'REQUEST_CHANGES',
            body: `**POCP Review:**\n\n${body}`,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          console.error(`GitHub review failed (${res.status}):`, err);
        } else {
          console.log(`Posted review on PR #${prData.prNumber} on ${prData.repo}`);
        }
      }
    } catch (err) {
      console.error('GitHub API relay error:', err);
    }
  }
);
