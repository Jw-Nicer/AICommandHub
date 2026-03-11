import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyAuth, requireMethod } from './utils/auth';
import { requireFields } from './utils/validate';

// POST /assign-task
export const assignTask = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { taskId, title, description, assignedSurface, priority, parentTaskId, dependsOn, metadata } = req.body;
  if (!requireFields(req.body, ['title', 'assignedSurface'], res)) return;

  const db = getFirestore();

  // If taskId provided, update existing task
  if (taskId) {
    const docRef = db.collection('tasks').doc(taskId);
    const doc = await docRef.get();

    if (!doc.exists) {
      res.status(404).json({ error: 'not_found', message: 'Task not found' });
      return;
    }

    if (doc.data()!.ownerId !== user.uid) {
      res.status(403).json({ error: 'forbidden', message: 'Not your task' });
      return;
    }

    await docRef.update({
      assignedSurface,
      status: 'assigned',
      ...(title && { title }),
      ...(description && { description }),
      ...(priority && { priority }),
      ...(metadata && { metadata }),
    });

    res.status(200).json({ taskId, status: 'assigned' });
    return;
  }

  // Determine initial status based on dependencies
  let initialStatus = 'assigned';
  if (dependsOn && dependsOn.length > 0) {
    // Check if all dependencies are done
    const depSnap = await db.getAll(
      ...dependsOn.map((id: string) => db.collection('tasks').doc(id))
    );
    const allDone = depSnap.every((d) => d.exists && d.data()?.status === 'done');
    if (!allDone) initialStatus = 'blocked';
  }

  const docRef = await db.collection('tasks').add({
    title,
    description: description || '',
    status: initialStatus,
    assignedSurface,
    priority: priority || 3,
    parentTaskId: parentTaskId || null,
    dependsOn: dependsOn || [],
    ownerId: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    completedAt: null,
    metadata: metadata || {},
  });

  res.status(201).json({
    taskId: docRef.id,
    status: initialStatus,
    createdAt: new Date().toISOString(),
  });
});

// POST /route-task — auto-assigns task to best available surface
export const routeTask = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { title, description, requiredCapabilities, priority, parentTaskId, dependsOn, metadata } = req.body;
  if (!requireFields(req.body, ['title'], res)) return;

  const db = getFirestore();
  const capabilities = requiredCapabilities || ['code'];

  // Get all surfaces for this user
  const surfacesSnap = await db.collection('surfaces')
    .where('ownerId', '==', user.uid)
    .get();

  if (surfacesSnap.empty) {
    res.status(404).json({ error: 'no_agents', message: 'No registered agents found' });
    return;
  }

  const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);

  // Score each surface
  const candidates: { surfaceId: string; name: string; score: number }[] = [];

  for (const doc of surfacesSnap.docs) {
    const data = doc.data();
    let score = 0;

    // Capability match (required)
    const agentCaps: string[] = data.capabilities || [];
    const capMatch = capabilities.filter((c: string) => agentCaps.includes(c)).length;
    if (capMatch === 0) continue; // Skip agents that can't do this work
    score += capMatch * 30; // 30 points per matching capability

    // Availability scoring
    const lastHb = data.lastHeartbeat?.toDate?.() || null;
    const isAlive = lastHb && lastHb >= threeMinutesAgo;
    if (!isAlive) {
      score -= 100; // Heavy penalty for inactive agents
    }

    if (data.status === 'idle') score += 50;
    else if (data.status === 'active') score += 20;
    else if (data.status === 'busy') score -= 20;

    // Queue depth penalty
    const taskCount = (data.currentTasks || []).length;
    score -= taskCount * 10;

    candidates.push({ surfaceId: doc.id, name: data.name, score });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Determine initial status based on dependencies
  let initialStatus = 'assigned';
  if (dependsOn && dependsOn.length > 0) {
    const depSnap = await db.getAll(
      ...dependsOn.map((id: string) => db.collection('tasks').doc(id))
    );
    const allDone = depSnap.every((d) => d.exists && d.data()?.status === 'done');
    if (!allDone) initialStatus = 'blocked';
  }

  const bestMatch = candidates.length > 0 ? candidates[0] : null;
  const assignedSurface = bestMatch ? bestMatch.surfaceId : '';

  const docRef = await db.collection('tasks').add({
    title,
    description: description || '',
    status: assignedSurface ? initialStatus : 'pending',
    assignedSurface,
    priority: priority || 3,
    parentTaskId: parentTaskId || null,
    dependsOn: dependsOn || [],
    ownerId: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    completedAt: null,
    metadata: {
      ...(metadata || {}),
      routedBy: 'task-router',
      requiredCapabilities: capabilities,
      routingScore: bestMatch?.score ?? null,
      candidatesConsidered: candidates.length,
    },
  });

  // Update the assigned surface's currentTasks
  if (assignedSurface) {
    const surfaceRef = db.collection('surfaces').doc(assignedSurface);
    const surfaceDoc = await surfaceRef.get();
    if (surfaceDoc.exists) {
      const currentTasks = surfaceDoc.data()!.currentTasks || [];
      await surfaceRef.update({
        currentTasks: [...currentTasks, docRef.id],
      });
    }
  }

  res.status(201).json({
    taskId: docRef.id,
    status: assignedSurface ? initialStatus : 'pending',
    assignedTo: bestMatch ? { surfaceId: bestMatch.surfaceId, name: bestMatch.name, score: bestMatch.score } : null,
    candidates: candidates.slice(0, 3).map((c) => ({ name: c.name, score: c.score })),
    createdAt: new Date().toISOString(),
  });
});

// POST /complete-task
export const completeTask = onRequest(async (req, res) => {
  if (!requireMethod(req, res, 'POST')) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const { taskId, surfaceId, outcome, output, durationMs, memoryEntries } = req.body;
  if (!requireFields(req.body, ['taskId', 'surfaceId', 'outcome'], res)) return;

  const db = getFirestore();
  const taskRef = db.collection('tasks').doc(taskId);
  const taskDoc = await taskRef.get();

  if (!taskDoc.exists) {
    res.status(404).json({ error: 'not_found', message: 'Task not found' });
    return;
  }

  if (taskDoc.data()!.ownerId !== user.uid) {
    res.status(403).json({ error: 'forbidden', message: 'Not your task' });
    return;
  }

  // Update task to done
  await taskRef.update({
    status: 'done',
    completedAt: FieldValue.serverTimestamp(),
    metadata: {
      ...taskDoc.data()!.metadata,
      outcome,
      output: output || {},
      durationMs: durationMs || null,
      completedBy: surfaceId,
    },
  });

  // Write any included memory entries
  if (Array.isArray(memoryEntries)) {
    for (const entry of memoryEntries) {
      await db.collection('memory').add({
        surfaceId,
        domain: entry.domain,
        key: entry.key,
        value: entry.value,
        confidence: entry.confidence || 1.0,
        sourceApprovalId: null,
        ownerId: user.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: taskDoc.data()!.assignedSurface || 'unknown',
      });
    }
  }

  // Check if completing this task unblocks other tasks
  const dependentSnap = await db.collection('tasks')
    .where('ownerId', '==', user.uid)
    .where('status', '==', 'blocked')
    .get();

  const unblockedTaskIds: string[] = [];

  for (const depDoc of dependentSnap.docs) {
    const depData = depDoc.data();
    if (!depData.dependsOn?.includes(taskId)) continue;

    // Check if ALL dependencies for this task are now done
    const allDepsDone = await Promise.all(
      depData.dependsOn.map(async (depId: string) => {
        const d = await db.collection('tasks').doc(depId).get();
        return d.exists && d.data()?.status === 'done';
      })
    );

    if (allDepsDone.every(Boolean)) {
      await depDoc.ref.update({ status: 'pending' });
      unblockedTaskIds.push(depDoc.id);
    }
  }

  res.status(200).json({
    taskId,
    status: 'done',
    outcome,
    unblockedTaskIds,
    memoryEntriesWritten: memoryEntries?.length || 0,
  });
});
