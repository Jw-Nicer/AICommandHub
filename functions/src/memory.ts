import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyAuth, requireMethod } from './utils/auth';
import { requireFields } from './utils/validate';

// POST /query-memory
export const queryMemory = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { domain, keyPattern, limit: queryLimit, minConfidence, createdBy } = req.body;
  if (!requireFields(req.body, ['domain'], res)) return;

  const db = getFirestore();
  let query: FirebaseFirestore.Query = db.collection('memory')
    .where('ownerId', '==', user.uid)
    .where('domain', '==', domain);

  // Prefix matching using Firestore range query
  if (keyPattern) {
    query = query
      .where('key', '>=', keyPattern)
      .where('key', '<=', keyPattern + '\uf8ff');
  }

  if (minConfidence !== undefined) {
    query = query.where('confidence', '>=', minConfidence);
  }

  if (createdBy) {
    query = query.where('createdBy', '==', createdBy);
  }

  query = query.orderBy('key').limit(queryLimit || 20);

  const snap = await query.get();
  const entries = snap.docs.map((doc) => ({
    memoryId: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
    updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || null,
  }));

  // Check for conflicts (multiple entries for same key with different values)
  const keyGroups: Record<string, unknown[]> = {};
  entries.forEach((e) => {
    const k = (e as Record<string, unknown>).key as string;
    if (!keyGroups[k]) keyGroups[k] = [];
    keyGroups[k].push(e);
  });
  const hasConflicts = Object.values(keyGroups).some((group) => group.length > 1);

  res.status(200).json({
    entries,
    totalCount: entries.length,
    hasConflicts,
  });
});

// POST /delete-memory
export const deleteMemory = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { memoryId } = req.body;
  if (!requireFields(req.body, ['memoryId'], res)) return;

  const db = getFirestore();
  const docRef = db.collection('memory').doc(memoryId);
  const doc = await docRef.get();

  if (!doc.exists) {
    res.status(404).json({ error: 'not_found', message: 'Memory entry not found' });
    return;
  }

  if (doc.data()!.ownerId !== user.uid) {
    res.status(403).json({ error: 'forbidden', message: 'Not your memory entry' });
    return;
  }

  await docRef.delete();
  res.status(200).json({ deleted: true, memoryId });
});

// POST /write-memory
export const writeMemory = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { surfaceId, domain, key, value, confidence, sourceApprovalId } = req.body;
  if (!requireFields(req.body, ['domain', 'key', 'value'], res)) return;

  const db = getFirestore();
  const conf = confidence ?? 1.0;

  // Check for existing entry with same domain + key
  const existingSnap = await db.collection('memory')
    .where('ownerId', '==', user.uid)
    .where('domain', '==', domain)
    .where('key', '==', key)
    .limit(1).get();

  if (!existingSnap.empty) {
    const existing = existingSnap.docs[0];
    const existingData = existing.data();

    // Higher confidence wins; equal confidence means most recent wins
    if (conf >= existingData.confidence) {
      // New entry wins — update existing
      await existing.ref.update({
        value,
        confidence: conf,
        surfaceId: surfaceId || existingData.surfaceId,
        sourceApprovalId: sourceApprovalId || null,
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: req.body.agentName || existingData.createdBy,
      });

      res.status(200).json({
        memoryId: existing.id,
        conflictDetected: true,
        resolution: 'new_value_wins',
        previousConfidence: existingData.confidence,
      });
      return;
    } else {
      // Existing entry wins — create approval for user to resolve
      const approvalRef = await db.collection('approval_queue').add({
        surfaceId: surfaceId || null,
        agentName: req.body.agentName || 'system',
        taskId: null,
        title: `Memory conflict: ${domain}/${key}`,
        description: `Conflicting values for memory key "${key}" in domain "${domain}". Existing value (confidence: ${existingData.confidence}) vs new value (confidence: ${conf}).`,
        diffPayload: {
          type: 'other',
          structuredData: {
            existing: existingData.value,
            proposed: value,
            existingConfidence: existingData.confidence,
            proposedConfidence: conf,
          },
        },
        riskLevel: 'medium',
        requiresApprovalBefore: 'execute',
        status: 'pending',
        ownerId: user.uid,
        requestedAt: FieldValue.serverTimestamp(),
        decidedAt: null,
        decisionNote: null,
        modifications: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h for conflicts
      });

      res.status(409).json({
        error: 'memory_conflict',
        memoryId: existing.id,
        conflictDetected: true,
        approvalId: approvalRef.id,
        existingValue: existingData.value,
        existingConfidence: existingData.confidence,
      });
      return;
    }
  }

  // No conflict — create new entry
  const docRef = await db.collection('memory').add({
    surfaceId: surfaceId || null,
    domain,
    key,
    value,
    confidence: conf,
    sourceApprovalId: sourceApprovalId || null,
    ownerId: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: req.body.agentName || 'unknown',
  });

  res.status(201).json({
    memoryId: docRef.id,
    conflictDetected: false,
  });
});
