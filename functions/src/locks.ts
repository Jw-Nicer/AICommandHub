import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyAuth, requireMethod } from './utils/auth';
import { requireFields, validateEnum } from './utils/validate';

const LOCK_TYPES = ['file', 'table', 'api_endpoint', 'domain'] as const;
const MAX_LOCK_MINUTES = 240;

// POST /lock-resource
export const lockResource = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { surfaceId, resourceType, resourcePath, durationMinutes } = req.body;
  if (!requireFields(req.body, ['surfaceId', 'resourceType', 'resourcePath'], res)) return;
  if (!validateEnum(resourceType, LOCK_TYPES, 'resourceType', res)) return;

  const duration = Math.min(durationMinutes || 30, MAX_LOCK_MINUTES);
  const db = getFirestore();

  // Check if resource is already locked
  const existingLock = await db.collection('locks')
    .where('resource', '==', resourcePath)
    .where('expiresAt', '>', new Date())
    .limit(1).get();

  if (!existingLock.empty) {
    const lock = existingLock.docs[0].data();
    res.status(423).json({
      error: 'resource_locked',
      message: `Resource already locked by ${lock.lockedBy}`,
      lockId: existingLock.docs[0].id,
      lockedBy: lock.lockedBy,
      surfaceId: lock.surfaceId,
      expiresAt: lock.expiresAt.toDate().toISOString(),
    });
    return;
  }

  // Resolve agent name from surfaceId
  const surfaceDoc = await db.collection('surfaces').doc(surfaceId).get();
  const agentName = surfaceDoc.exists ? surfaceDoc.data()!.name : surfaceId;

  const expiresAt = new Date(Date.now() + duration * 60 * 1000);
  const docRef = await db.collection('locks').add({
    lockType: resourceType,
    resource: resourcePath,
    lockedBy: agentName,
    surfaceId,
    ownerId: user.uid,
    lockedAt: FieldValue.serverTimestamp(),
    expiresAt,
  });

  res.status(200).json({
    lockId: docRef.id,
    resource: resourcePath,
    lockedBy: agentName,
    expiresAt: expiresAt.toISOString(),
    durationMinutes: duration,
  });
});

// POST /unlock-resource
export const unlockResource = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { lockId, surfaceId } = req.body;
  if (!requireFields(req.body, ['lockId', 'surfaceId'], res)) return;

  const db = getFirestore();
  const lockRef = db.collection('locks').doc(lockId);
  const lockDoc = await lockRef.get();

  if (!lockDoc.exists) {
    res.status(404).json({ error: 'not_found', message: 'Lock not found' });
    return;
  }

  const lockData = lockDoc.data()!;
  if (lockData.ownerId !== user.uid) {
    res.status(403).json({ error: 'forbidden', message: 'Not your lock' });
    return;
  }

  if (lockData.surfaceId !== surfaceId) {
    res.status(403).json({ error: 'forbidden', message: 'Lock owned by a different agent' });
    return;
  }

  await lockRef.delete();

  res.status(200).json({
    lockId,
    unlocked: true,
    resource: lockData.resource,
  });
});

// POST /conflict-report
export const conflictReport = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { reportingAgent, conflictType, resource, otherAgent, details, suggestedResolution } = req.body;
  if (!requireFields(req.body, ['reportingAgent', 'conflictType', 'resource', 'otherAgent', 'details'], res)) return;

  const db = getFirestore();

  // Create approval entry for user to resolve
  const approvalRef = await db.collection('approval_queue').add({
    surfaceId: null,
    agentName: 'system',
    taskId: null,
    title: `Conflict: ${conflictType} on ${resource}`,
    description: `${reportingAgent} reports a ${conflictType} with ${otherAgent} on resource "${resource}". Details: ${details}. ${suggestedResolution ? `Suggested resolution: ${suggestedResolution}` : ''}`,
    diffPayload: {
      type: 'other',
      structuredData: {
        conflictType,
        resource,
        reportingAgent,
        otherAgent,
        details,
        suggestedResolution: suggestedResolution || null,
      },
    },
    riskLevel: 'high',
    requiresApprovalBefore: 'execute',
    status: 'pending',
    ownerId: user.uid,
    requestedAt: FieldValue.serverTimestamp(),
    decidedAt: null,
    decisionNote: null,
    modifications: null,
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4h for conflicts
  });

  // Pause both agents' current tasks
  const agentNames = [reportingAgent, otherAgent];
  for (const agentName of agentNames) {
    const surfaceSnap = await db.collection('surfaces')
      .where('name', '==', agentName)
      .where('ownerId', '==', user.uid)
      .limit(1).get();

    if (!surfaceSnap.empty) {
      const sid = surfaceSnap.docs[0].id;
      const tasksSnap = await db.collection('tasks')
        .where('assignedSurface', '==', sid)
        .where('ownerId', '==', user.uid)
        .where('status', '==', 'in_progress')
        .get();

      const batch = db.batch();
      tasksSnap.docs.forEach((doc) => {
        batch.update(doc.ref, { status: 'blocked' });
      });
      await batch.commit();
    }
  }

  res.status(201).json({
    conflictId: approvalRef.id,
    approvalId: approvalRef.id,
    bothAgentsPaused: true,
    resource,
    conflictType,
  });
});

// Scheduled: Clean up expired locks every 5 minutes
export const cleanupExpiredLocks = onSchedule('every 5 minutes', async () => {
  const db = getFirestore();
  const now = new Date();

  const expiredSnap = await db.collection('locks')
    .where('expiresAt', '<=', now)
    .get();

  if (expiredSnap.empty) return;

  const batch = db.batch();
  expiredSnap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  console.log(`Cleaned up ${expiredSnap.size} expired locks`);
});
