import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { verifyAuth, requireMethod } from './utils/auth';
import { requireFields, validateEnum } from './utils/validate';
import { classifyRisk } from './utils/risk';

const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
const DECISIONS = ['approved', 'rejected', 'modified'] as const;
const APPROVAL_BEFORE = ['commit', 'deploy', 'execute', 'publish'] as const;

// POST /submit-approval
export const submitApproval = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const body = req.body;
  if (!requireFields(body, ['agentName', 'title'], res)) return;
  if (!validateEnum(body.riskLevel, RISK_LEVELS, 'riskLevel', res)) return;
  if (!validateEnum(body.requiresApprovalBefore, APPROVAL_BEFORE, 'requiresApprovalBefore', res)) return;

  const db = getFirestore();

  // Resolve surfaceId from agentName if not provided
  let surfaceId = body.surfaceId;
  if (!surfaceId && body.agentName) {
    const snap = await db.collection('surfaces')
      .where('name', '==', body.agentName)
      .where('ownerId', '==', user.uid)
      .limit(1).get();
    if (!snap.empty) surfaceId = snap.docs[0].id;
  }

  // Check for file locks if diff includes file paths
  const filePaths = body.diffPayload?.structuredData?.filePaths;
  if (Array.isArray(filePaths)) {
    for (const filePath of filePaths) {
      const lockSnap = await db.collection('locks')
        .where('resource', '==', filePath)
        .where('expiresAt', '>', new Date())
        .limit(1).get();
      if (!lockSnap.empty) {
        const lock = lockSnap.docs[0].data();
        res.status(409).json({
          error: 'resource_locked',
          message: `${filePath} is locked by ${lock.lockedBy}`,
          lockedBy: lock.lockedBy,
          expiresAt: lock.expiresAt.toDate().toISOString(),
        });
        return;
      }
    }
  }

  // Intelligent risk classification
  const riskClassification = classifyRisk(body.riskLevel, body.title, body.diffPayload);

  // Check auto-approve rules for low-risk items
  let autoApproved = false;
  if (riskClassification.level === 'low') {
    const settingsSnap = await db.collection('user_settings').doc(user.uid).get();
    const settings = settingsSnap.exists ? settingsSnap.data() : null;

    if (settings?.autoApproveLowRisk) {
      // Check if agent has auto-approve rule
      const rulesSnap = await db.collection('auto_approve_rules')
        .where('ownerId', '==', user.uid)
        .where('enabled', '==', true)
        .where('agentName', '==', body.agentName)
        .limit(1).get();

      if (!rulesSnap.empty || settings.autoApproveLowRisk === true) {
        autoApproved = true;
      }
    }
  }

  const docRef = await db.collection('approval_queue').add({
    surfaceId: surfaceId || null,
    agentName: body.agentName,
    taskId: body.taskId || null,
    title: body.title,
    description: body.description || '',
    diffPayload: body.diffPayload || {},
    riskLevel: riskClassification.level,
    requiresApprovalBefore: body.requiresApprovalBefore || 'execute',
    status: autoApproved ? 'approved' : 'pending',
    decisionNote: autoApproved ? 'Auto-approved: low risk' : null,
    modifications: null,
    ownerId: user.uid,
    requestedAt: FieldValue.serverTimestamp(),
    decidedAt: autoApproved ? FieldValue.serverTimestamp() : null,
    expiresAt: body.expiresAt
      ? new Date(body.expiresAt)
      : new Date(Date.now() + 60 * 60 * 1000),
    riskClassification: {
      score: riskClassification.score,
      reasons: riskClassification.reasons,
      agentRequested: body.riskLevel || null,
      classifiedAs: riskClassification.level,
    },
  });

  const pendingSnap = await db.collection('approval_queue')
    .where('ownerId', '==', user.uid)
    .where('status', '==', 'pending')
    .count().get();

  res.status(201).json({
    approvalId: docRef.id,
    status: autoApproved ? 'approved' : 'pending',
    autoApproved,
    riskLevel: riskClassification.level,
    riskScore: riskClassification.score,
    riskReasons: riskClassification.reasons,
    queuePosition: autoApproved ? 0 : pendingSnap.data().count,
    createdAt: new Date().toISOString(),
  });
});

// POST /decide
export const decide = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { approvalId, decision, decisionNote, modifications } = req.body;
  if (!requireFields(req.body, ['approvalId', 'decision'], res)) return;
  if (!validateEnum(decision, DECISIONS, 'decision', res)) return;

  const db = getFirestore();
  const docRef = db.collection('approval_queue').doc(approvalId);
  const doc = await docRef.get();

  if (!doc.exists) {
    res.status(404).json({ error: 'not_found', message: 'Approval not found' });
    return;
  }

  const data = doc.data()!;
  if (data.ownerId !== user.uid) {
    res.status(403).json({ error: 'forbidden', message: 'Not your approval' });
    return;
  }

  if (data.status !== 'pending') {
    res.status(409).json({ error: 'already_decided', message: `Approval already ${data.status}` });
    return;
  }

  const updateData: Record<string, unknown> = {
    status: decision,
    decidedAt: FieldValue.serverTimestamp(),
    decisionNote: decisionNote || null,
  };
  if (decision === 'modified' && modifications) {
    updateData.modifications = modifications;
  }

  await docRef.update(updateData);

  res.status(200).json({
    approvalId,
    status: decision,
    decidedAt: new Date().toISOString(),
    agentNotified: true,
  });
});

// POST /batch-decide
export const batchDecide = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { decisions } = req.body;
  if (!Array.isArray(decisions) || decisions.length === 0) {
    res.status(400).json({ error: 'validation_error', message: 'decisions must be a non-empty array' });
    return;
  }

  const db = getFirestore();
  const results: { approvalId: string; status: string; error?: string }[] = [];

  const batch = db.batch();
  for (const d of decisions) {
    const docRef = db.collection('approval_queue').doc(d.approvalId);
    const doc = await docRef.get();

    if (!doc.exists) {
      results.push({ approvalId: d.approvalId, status: 'error', error: 'not_found' });
      continue;
    }

    const data = doc.data()!;
    if (data.ownerId !== user.uid) {
      results.push({ approvalId: d.approvalId, status: 'error', error: 'forbidden' });
      continue;
    }

    if (data.status !== 'pending') {
      results.push({ approvalId: d.approvalId, status: 'error', error: 'already_decided' });
      continue;
    }

    batch.update(docRef, {
      status: d.decision,
      decidedAt: FieldValue.serverTimestamp(),
      decisionNote: d.decisionNote || null,
    });
    results.push({ approvalId: d.approvalId, status: d.decision });
  }

  await batch.commit();

  res.status(200).json({
    processed: results.filter((r) => !r.error).length,
    results,
  });
});

// Trigger: Send FCM push when new approval created
export const onApprovalCreated = onDocumentCreated(
  'approval_queue/{approvalId}',
  async (event) => {
    const approval = event.data?.data();
    if (!approval) return;

    try {
      await getMessaging().send({
        topic: `user_${approval.ownerId}`,
        notification: {
          title: `${approval.agentName}: ${approval.riskLevel} risk`,
          body: approval.title,
        },
        data: {
          approvalId: event.params.approvalId,
          riskLevel: approval.riskLevel,
          deepLink: `/approval/${event.params.approvalId}`,
        },
      });
    } catch (err) {
      console.error('FCM send failed:', err);
    }
  }
);

// Trigger: Log outcome and notify agent when approval decided
export const onApprovalDecided = onDocumentUpdated(
  'approval_queue/{approvalId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    if (before.status !== 'pending' || after.status === 'pending') return;

    const db = getFirestore();

    // Write to execution_log
    await db.collection('execution_log').add({
      approvalId: event.params.approvalId,
      surfaceId: after.surfaceId,
      agentName: after.agentName,
      action: `approval_${after.status}`,
      outcome: after.status === 'approved' ? 'success' : 'halted',
      output: {
        decision: after.status,
        decisionNote: after.decisionNote || null,
        modifications: after.modifications || null,
      },
      ownerId: after.ownerId,
      executedAt: FieldValue.serverTimestamp(),
      durationMs: after.decidedAt && after.requestedAt
        ? after.decidedAt.toMillis() - after.requestedAt.toMillis()
        : null,
    });

    // Auto-write memory when approval is approved
    if (after.status === 'approved' && after.diffPayload) {
      try {
        const memoryDomain = after.diffPayload.structuredData?.domain || 'codebase';
        const filePaths = after.diffPayload.structuredData?.filePaths;
        const memoryKey = filePaths?.length
          ? `approved:${filePaths[0].replace(/\//g, ':')}`
          : `approved:${event.params.approvalId.slice(0, 8)}`;

        await db.collection('memory').add({
          surfaceId: after.surfaceId || null,
          domain: memoryDomain,
          key: memoryKey,
          value: {
            title: after.title,
            agentName: after.agentName,
            filesChanged: after.diffPayload.filesChanged || 0,
            approvedAt: new Date().toISOString(),
          },
          confidence: 1.0,
          sourceApprovalId: event.params.approvalId,
          ownerId: after.ownerId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: 'system',
        });
      } catch (memErr) {
        console.error('Auto memory write failed:', memErr);
      }
    }

    // Publish to Pub/Sub for server-side agents
    try {
      const { PubSub } = await import('@google-cloud/pubsub');
      const pubsub = new PubSub();
      await pubsub.topic('pocp-agent-bus').publishMessage({
        data: Buffer.from(JSON.stringify({
          type: 'approval_decided',
          approvalId: event.params.approvalId,
          agentName: after.agentName,
          surfaceId: after.surfaceId,
          decision: after.status,
          decisionNote: after.decisionNote,
          modifications: after.modifications,
        })),
        attributes: {
          eventType: 'approval_decided',
          agentName: after.agentName,
        },
      });
    } catch (err) {
      console.error('Pub/Sub publish failed:', err);
    }
  }
);

// Trigger: Detect file conflicts when new approval is created
export const onApprovalConflictCheck = onDocumentCreated(
  'approval_queue/{approvalId}',
  async (event) => {
    const approval = event.data?.data();
    if (!approval) return;

    const filePaths = approval.diffPayload?.structuredData?.filePaths;
    if (!Array.isArray(filePaths) || filePaths.length === 0) return;

    const db = getFirestore();

    // Find other pending approvals from different agents that touch the same files
    const pendingSnap = await db.collection('approval_queue')
      .where('ownerId', '==', approval.ownerId)
      .where('status', '==', 'pending')
      .get();

    const conflicts: { approvalId: string; agentName: string; overlappingFiles: string[] }[] = [];

    for (const doc of pendingSnap.docs) {
      if (doc.id === event.params.approvalId) continue;
      const other = doc.data();
      if (other.agentName === approval.agentName) continue;

      const otherFiles: string[] = other.diffPayload?.structuredData?.filePaths || [];
      const overlap = filePaths.filter((f: string) => otherFiles.includes(f));

      if (overlap.length > 0) {
        conflicts.push({
          approvalId: doc.id,
          agentName: other.agentName,
          overlappingFiles: overlap,
        });
      }
    }

    if (conflicts.length === 0) return;

    // Create a conflict resolution approval
    await db.collection('approval_queue').add({
      surfaceId: null,
      agentName: 'system',
      taskId: null,
      title: `File conflict: ${conflicts[0].overlappingFiles[0]}${conflicts[0].overlappingFiles.length > 1 ? ` +${conflicts[0].overlappingFiles.length - 1} more` : ''}`,
      description: `Agent "${approval.agentName}" and "${conflicts[0].agentName}" both modify overlapping files. Review both changes to prevent contradictions.`,
      diffPayload: {
        type: 'other',
        structuredData: {
          conflictType: 'file_collision',
          triggeredBy: event.params.approvalId,
          triggerAgent: approval.agentName,
          conflicts: conflicts.map((c) => ({
            approvalId: c.approvalId,
            agentName: c.agentName,
            overlappingFiles: c.overlappingFiles,
          })),
        },
      },
      riskLevel: 'high',
      requiresApprovalBefore: 'execute',
      status: 'pending',
      ownerId: approval.ownerId,
      requestedAt: FieldValue.serverTimestamp(),
      decidedAt: null,
      decisionNote: null,
      modifications: null,
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    });

    console.log(`File conflict detected: ${approval.agentName} vs ${conflicts.map((c) => c.agentName).join(', ')}`);
  }
);

// Scheduled: Auto-reject expired approvals every 5 minutes
export const autoRejectExpired = onSchedule('every 5 minutes', async () => {
  const db = getFirestore();
  const now = new Date();

  const expiredSnap = await db.collection('approval_queue')
    .where('status', '==', 'pending')
    .where('expiresAt', '<=', now)
    .get();

  if (expiredSnap.empty) return;

  const batch = db.batch();
  expiredSnap.docs.forEach((doc) => {
    batch.update(doc.ref, {
      status: 'rejected',
      decisionNote: 'Auto-rejected: approval expired',
      decidedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  console.log(`Auto-rejected ${expiredSnap.size} expired approvals`);
});
