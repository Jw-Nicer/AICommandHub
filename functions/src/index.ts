import { initializeApp } from 'firebase-admin/app';

initializeApp();

// Approval flow
export {
  submitApproval,
  decide,
  batchDecide,
  onApprovalCreated,
  onApprovalDecided,
  onApprovalConflictCheck,
  autoRejectExpired,
} from './approval';

// Agent lifecycle
export {
  registerAgent,
  heartbeat,
  getDashboard,
  registerDevice,
} from './agents';

// Memory
export {
  queryMemory,
  writeMemory,
  deleteMemory,
} from './memory';

// Tasks
export {
  assignTask,
  routeTask,
  completeTask,
} from './tasks';

// Locks & conflicts
export {
  lockResource,
  unlockResource,
  conflictReport,
  cleanupExpiredLocks,
} from './locks';

// Intelligence (pattern learning, auto-approve rules, digest)
export {
  getSettings,
  saveSettings,
  getDigests,
  analyzePatterns,
  toggleRule,
  getRules,
  weeklyDigest,
} from './intelligence';

// Webhooks (Codex GitHub integration)
export {
  githubWebhook,
  relayCodexDecision,
} from './webhooks';
