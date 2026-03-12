import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { verifyAuth, requireMethod } from './utils/auth';
import { requireFields, validateEnum } from './utils/validate';

const SURFACE_TYPES = ['terminal', 'desktop', 'browser', 'mobile', 'ide'] as const;
const AGENT_STATUSES = ['active', 'busy', 'idle'] as const;

// POST /register-agent
export const registerAgent = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { name, type, capabilities, metadata } = req.body;
  if (!requireFields(req.body, ['name', 'type', 'capabilities'], res)) return;
  if (!validateEnum(type, SURFACE_TYPES, 'type', res)) return;

  const db = getFirestore();

  // Check for duplicate agent name for this user
  const existing = await db.collection('surfaces')
    .where('name', '==', name)
    .where('ownerId', '==', user.uid)
    .limit(1).get();

  if (!existing.empty) {
    res.status(409).json({
      error: 'already_exists',
      message: `Agent '${name}' already registered`,
      surfaceId: existing.docs[0].id,
    });
    return;
  }

  const docRef = await db.collection('surfaces').add({
    name,
    type,
    status: 'idle',
    ownerId: user.uid,
    capabilities: capabilities || [],
    lastHeartbeat: FieldValue.serverTimestamp(),
    currentTasks: [],
    metadata: metadata || {},
  });

  res.status(201).json({
    surfaceId: docRef.id,
    name,
    status: 'idle',
    createdAt: new Date().toISOString(),
  });
});

// POST /heartbeat
export const heartbeat = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { surfaceId, status, currentTasks, load } = req.body;
  if (!requireFields(req.body, ['surfaceId'], res)) return;
  if (status && !validateEnum(status, AGENT_STATUSES, 'status', res)) return;

  const db = getFirestore();
  const docRef = db.collection('surfaces').doc(surfaceId);
  const doc = await docRef.get();

  if (!doc.exists) {
    res.status(404).json({ error: 'not_found', message: 'Surface not found' });
    return;
  }

  if (doc.data()!.ownerId !== user.uid) {
    res.status(403).json({ error: 'forbidden', message: 'Not your surface' });
    return;
  }

  const updateData: Record<string, unknown> = {
    lastHeartbeat: FieldValue.serverTimestamp(),
  };
  if (status) updateData.status = status;
  if (currentTasks) updateData.currentTasks = currentTasks;
  if (load) updateData['metadata.load'] = load;

  await docRef.update(updateData);

  // Return pending task assignments for this agent (polling fallback)
  const agentName = doc.data()!.name;
  const pendingTasks = await db.collection('tasks')
    .where('assignedSurface', '==', surfaceId)
    .where('ownerId', '==', user.uid)
    .where('status', '==', 'assigned')
    .limit(5).get();

  // Return pending approval decisions for this agent
  const pendingDecisions = await db.collection('approval_queue')
    .where('surfaceId', '==', surfaceId)
    .where('ownerId', '==', user.uid)
    .where('status', 'in', ['approved', 'rejected', 'modified'])
    .limit(10).get();

  res.status(200).json({
    surfaceId,
    status: status || doc.data()!.status,
    heartbeatAt: new Date().toISOString(),
    pendingTasks: pendingTasks.docs.map((d) => ({ id: d.id, ...d.data() })),
    pendingDecisions: pendingDecisions.docs.map((d) => ({
      approvalId: d.id,
      status: d.data().status,
      decisionNote: d.data().decisionNote,
      modifications: d.data().modifications,
    })),
    agentName,
  });
});

// GET /get-dashboard
export const getDashboard = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'GET')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const db = getFirestore();
  const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);

  // Get all surfaces for this user
  const surfacesSnap = await db.collection('surfaces')
    .where('ownerId', '==', user.uid).get();

  const agents = surfacesSnap.docs.map((doc) => {
    const data = doc.data();
    const lastHb = data.lastHeartbeat?.toDate?.() || null;
    const isInactive = !lastHb || lastHb < threeMinutesAgo;
    return {
      surfaceId: doc.id,
      name: data.name,
      type: data.type,
      status: isInactive ? 'inactive' : data.status,
      currentTasks: data.currentTasks || [],
      lastHeartbeat: lastHb?.toISOString() || null,
      capabilities: data.capabilities,
    };
  });

  // Queue metrics
  const pendingSnap = await db.collection('approval_queue')
    .where('ownerId', '==', user.uid)
    .where('status', '==', 'pending')
    .count().get();

  // Task metrics
  const inProgressTasks = await db.collection('tasks')
    .where('ownerId', '==', user.uid)
    .where('status', '==', 'in_progress')
    .count().get();

  const blockedTasks = await db.collection('tasks')
    .where('ownerId', '==', user.uid)
    .where('status', '==', 'blocked')
    .count().get();

  // Memory metrics
  const memoryCount = await db.collection('memory')
    .where('ownerId', '==', user.uid)
    .count().get();

  res.status(200).json({
    agents,
    queue: {
      pendingCount: pendingSnap.data().count,
    },
    tasks: {
      inProgress: inProgressTasks.data().count,
      blocked: blockedTasks.data().count,
    },
    memory: {
      totalEntries: memoryCount.data().count,
    },
    generatedAt: new Date().toISOString(),
  });
});

// POST /register-device — Register FCM token and subscribe to user topic
export const registerDevice = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { fcmToken, platform } = req.body;
  if (!requireFields(req.body, ['fcmToken', 'platform'], res)) return;

  const db = getFirestore();
  const topic = `user_${user.uid}`;

  // Subscribe the token to the user's FCM topic
  try {
    await getMessaging().subscribeToTopic([fcmToken], topic);
  } catch (err) {
    console.error('FCM topic subscription failed:', err);
    res.status(500).json({ error: 'fcm_subscription_failed', message: 'Could not subscribe to push notifications' });
    return;
  }

  // Upsert device doc — find existing by token or create new
  const existingSnap = await db.collection('devices')
    .where('ownerId', '==', user.uid)
    .where('fcmToken', '==', fcmToken)
    .limit(1).get();

  if (!existingSnap.empty) {
    await existingSnap.docs[0].ref.update({
      platform,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(200).json({ deviceId: existingSnap.docs[0].id, topic, updated: true });
  } else {
    const docRef = await db.collection('devices').add({
      ownerId: user.uid,
      fcmToken,
      platform,
      fcmTopic: topic,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ deviceId: docRef.id, topic, updated: false });
  }
});
