import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyAuth, requireMethod } from './utils/auth';

// GET /get-settings — Get user settings
export const getSettings = onRequest(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const user = await verifyAuth(req, res);
  if (!user) return;

  const db = getFirestore();
  const docRef = db.collection('user_settings').doc(user.uid);
  const doc = await docRef.get();

  res.status(200).json(doc.exists ? doc.data() : {
    autoApproveLowRisk: false,
    notificationsEnabled: true,
  });
});

// POST /save-settings — Save user settings
export const saveSettings = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const db = getFirestore();
  const { autoApproveLowRisk, notificationsEnabled } = req.body;

  await db.collection('user_settings').doc(user.uid).set({
    autoApproveLowRisk: !!autoApproveLowRisk,
    notificationsEnabled: notificationsEnabled !== false,
    ownerId: user.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  res.status(200).json({ saved: true });
});

// GET /get-digests — Get recent weekly digests
export const getDigests = onRequest(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const user = await verifyAuth(req, res);
  if (!user) return;

  const db = getFirestore();
  const digestsSnap = await db.collection('digests')
    .where('ownerId', '==', user.uid)
    .orderBy('createdAt', 'desc')
    .limit(4)
    .get();

  const digests = digestsSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
  }));

  res.status(200).json({ digests });
});

// POST /analyze-patterns — Analyze approval history and suggest auto-approve rules
export const analyzePatterns = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const db = getFirestore();

  // Get recent execution logs (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const logsSnap = await db.collection('execution_log')
    .where('ownerId', '==', user.uid)
    .where('executedAt', '>=', thirtyDaysAgo)
    .get();

  // Get corresponding approvals for context
  const approvalIds = new Set<string>();
  const logsByApproval: Record<string, FirebaseFirestore.DocumentData> = {};
  for (const doc of logsSnap.docs) {
    const data = doc.data();
    if (data.approvalId) {
      approvalIds.add(data.approvalId);
      logsByApproval[data.approvalId] = data;
    }
  }

  // Fetch the approval docs
  const approvalDocs: Record<string, FirebaseFirestore.DocumentData> = {};
  const approvalIdArray = Array.from(approvalIds);
  for (let i = 0; i < approvalIdArray.length; i += 10) {
    const batch = approvalIdArray.slice(i, i + 10);
    const refs = batch.map((id) => db.collection('approval_queue').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) approvalDocs[snap.id] = snap.data()!;
    }
  }

  // Analyze patterns per agent
  const agentStats: Record<string, {
    total: number;
    approved: number;
    rejected: number;
    lowRiskApproved: number;
    lowRiskTotal: number;
    avgResponseMs: number;
    responseTimes: number[];
  }> = {};

  for (const [approvalId, log] of Object.entries(logsByApproval)) {
    const approval = approvalDocs[approvalId];
    if (!approval) continue;

    const agent = approval.agentName as string;
    if (!agentStats[agent]) {
      agentStats[agent] = {
        total: 0, approved: 0, rejected: 0,
        lowRiskApproved: 0, lowRiskTotal: 0,
        avgResponseMs: 0, responseTimes: [],
      };
    }

    const stats = agentStats[agent];
    stats.total++;

    if (log.outcome === 'success') stats.approved++;
    else stats.rejected++;

    if (approval.riskLevel === 'low') {
      stats.lowRiskTotal++;
      if (log.outcome === 'success') stats.lowRiskApproved++;
    }

    if (log.durationMs) stats.responseTimes.push(log.durationMs);
  }

  // Generate suggested rules
  const suggestions: {
    agentName: string;
    ruleType: string;
    confidence: number;
    reason: string;
  }[] = [];

  for (const [agent, stats] of Object.entries(agentStats)) {
    stats.avgResponseMs = stats.responseTimes.length > 0
      ? stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length
      : 0;

    // Rule: Agent with 100% low-risk approval rate (min 5 approvals)
    if (stats.lowRiskTotal >= 5 && stats.lowRiskApproved === stats.lowRiskTotal) {
      suggestions.push({
        agentName: agent,
        ruleType: 'auto_approve_low_risk',
        confidence: Math.min(0.95, 0.7 + (stats.lowRiskTotal / 100)),
        reason: `${agent} has ${stats.lowRiskTotal} low-risk approvals, all approved`,
      });
    }

    // Rule: Agent with >90% overall approval rate (min 10 approvals)
    if (stats.total >= 10 && (stats.approved / stats.total) > 0.9) {
      const rate = Math.round((stats.approved / stats.total) * 100);
      suggestions.push({
        agentName: agent,
        ruleType: 'trusted_agent',
        confidence: Math.min(0.9, (stats.approved / stats.total)),
        reason: `${agent} has ${rate}% approval rate across ${stats.total} submissions`,
      });
    }
  }

  // Save suggestions to Firestore
  for (const suggestion of suggestions) {
    // Check if rule already exists
    const existing = await db.collection('auto_approve_rules')
      .where('ownerId', '==', user.uid)
      .where('agentName', '==', suggestion.agentName)
      .where('ruleType', '==', suggestion.ruleType)
      .limit(1).get();

    if (existing.empty) {
      await db.collection('auto_approve_rules').add({
        ...suggestion,
        ownerId: user.uid,
        enabled: false, // User must manually enable
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await existing.docs[0].ref.update({
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  res.status(200).json({
    agentStats: Object.fromEntries(
      Object.entries(agentStats).map(([agent, stats]) => [agent, {
        total: stats.total,
        approved: stats.approved,
        rejected: stats.rejected,
        approvalRate: stats.total > 0 ? Math.round((stats.approved / stats.total) * 100) : 0,
        lowRiskApprovalRate: stats.lowRiskTotal > 0
          ? Math.round((stats.lowRiskApproved / stats.lowRiskTotal) * 100) : 0,
        avgResponseMs: Math.round(stats.avgResponseMs),
      }])
    ),
    suggestions,
    totalLogsAnalyzed: logsSnap.size,
  });
});

// POST /toggle-rule — Enable/disable an auto-approve rule
export const toggleRule = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { ruleId, enabled } = req.body;
  if (!ruleId || enabled === undefined) {
    res.status(400).json({ error: 'validation_error', message: 'ruleId and enabled required' });
    return;
  }

  const db = getFirestore();
  const ruleRef = db.collection('auto_approve_rules').doc(ruleId);
  const ruleDoc = await ruleRef.get();

  if (!ruleDoc.exists) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  if (ruleDoc.data()!.ownerId !== user.uid) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  await ruleRef.update({ enabled: !!enabled, updatedAt: FieldValue.serverTimestamp() });

  res.status(200).json({ ruleId, enabled: !!enabled });
});

// GET /get-rules — Get all auto-approve rules for the user
export const getRules = onRequest(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const user = await verifyAuth(req, res);
  if (!user) return;

  const db = getFirestore();
  const rulesSnap = await db.collection('auto_approve_rules')
    .where('ownerId', '==', user.uid)
    .get();

  const rules = rulesSnap.docs.map((doc) => ({
    ruleId: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
    updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || null,
  }));

  res.status(200).json({ rules });
});

// Scheduled: Generate weekly digest every Monday at 8 AM
export const weeklyDigest = onSchedule('every monday 08:00', async () => {
  const db = getFirestore();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get all users who have surfaces (active users)
  const surfacesSnap = await db.collection('surfaces').get();
  const ownerIds = new Set<string>();
  surfacesSnap.docs.forEach((doc) => ownerIds.add(doc.data().ownerId));

  for (const ownerId of ownerIds) {
    try {
      // Approvals this week
      const approvalsSnap = await db.collection('approval_queue')
        .where('ownerId', '==', ownerId)
        .where('requestedAt', '>=', weekAgo)
        .get();

      let approved = 0, rejected = 0, expired = 0, autoApproved = 0;
      const agentBreakdown: Record<string, number> = {};
      const responseTimes: number[] = [];

      for (const doc of approvalsSnap.docs) {
        const data = doc.data();
        if (data.status === 'approved') {
          approved++;
          if (data.decisionNote === 'Auto-approved: low risk') autoApproved++;
        }
        else if (data.status === 'rejected') {
          if (data.decisionNote?.includes('expired')) expired++;
          else rejected++;
        }

        const agent = data.agentName as string;
        agentBreakdown[agent] = (agentBreakdown[agent] || 0) + 1;

        if (data.decidedAt && data.requestedAt) {
          const decided = data.decidedAt.toDate?.()?.getTime() || 0;
          const requested = data.requestedAt.toDate?.()?.getTime() || 0;
          if (decided > requested) responseTimes.push(decided - requested);
        }
      }

      // Memory entries this week
      const memorySnap = await db.collection('memory')
        .where('ownerId', '==', ownerId)
        .where('createdAt', '>=', weekAgo)
        .count().get();

      // Tasks completed this week
      const tasksSnap = await db.collection('tasks')
        .where('ownerId', '==', ownerId)
        .where('completedAt', '>=', weekAgo)
        .count().get();

      const avgResponseMs = responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

      await db.collection('digests').add({
        ownerId,
        weekStart: weekAgo.toISOString(),
        weekEnd: new Date().toISOString(),
        approvals: {
          total: approvalsSnap.size,
          approved,
          rejected,
          expired,
          autoApproved,
          avgResponseMs: Math.round(avgResponseMs),
        },
        agentBreakdown,
        memoryEntriesCreated: memorySnap.data().count,
        tasksCompleted: tasksSnap.data().count,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error(`Digest generation failed for ${ownerId}:`, err);
    }
  }
});
