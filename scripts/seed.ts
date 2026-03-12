#!/usr/bin/env npx ts-node

/**
 * Seed Script — Populate Firestore with the 6 agent definitions
 *
 * Usage:
 *   npx ts-node scripts/seed.ts --project-id <firebase-project-id> --owner-id <firebase-auth-uid>
 *
 * Or use Firebase Admin with service account:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx ts-node scripts/seed.ts --owner-id <uid>
 */

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';

// Parse args
const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const projectId = getArg('--project-id') || process.env.FIREBASE_PROJECT_ID;
const ownerId = getArg('--owner-id');

if (!ownerId) {
  console.error('Error: --owner-id is required (Firebase Auth UID)');
  console.error('Usage: npx ts-node scripts/seed.ts --owner-id <uid> [--project-id <id>]');
  process.exit(1);
}

// Initialize Firebase Admin
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
  const sa = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8')) as ServiceAccount;
  initializeApp({ credential: cert(sa), projectId: sa.projectId || projectId });
} else if (projectId) {
  initializeApp({ projectId });
} else {
  console.error('Error: Set --project-id or GOOGLE_APPLICATION_CREDENTIALS');
  process.exit(1);
}

const db = getFirestore();

// The 6 agent definitions from Agent.md §2.1
const agents = [
  {
    name: 'claude-code',
    type: 'terminal',
    capabilities: ['code', 'files', 'deploy'],
    metadata: {
      description: 'Claude Code CLI — terminal-based coding agent',
      platform: 'cli',
    },
  },
  {
    name: 'cowork-desktop',
    type: 'desktop',
    capabilities: ['code', 'files', 'research'],
    metadata: {
      description: 'Claude Cowork — desktop coding assistant',
      platform: 'desktop',
    },
  },
  {
    name: 'openai-codex',
    type: 'browser',
    capabilities: ['code', 'files', 'deploy'],
    metadata: {
      description: 'OpenAI Codex — cloud-based code generation via GitHub PRs',
      platform: 'cloud',
    },
  },
  {
    name: 'chatgpt',
    type: 'browser',
    capabilities: ['research', 'data'],
    metadata: {
      description: 'ChatGPT — browser-based conversational AI',
      platform: 'web',
    },
  },
  {
    name: 'antigravity-ide',
    type: 'ide',
    capabilities: ['code', 'files', 'deploy'],
    metadata: {
      description: 'Antigravity IDE — integrated development environment',
      platform: 'ide',
    },
  },
  {
    name: 'excel-claude',
    type: 'desktop',
    capabilities: ['data'],
    metadata: {
      description: 'Excel Claude — spreadsheet operations via Office Scripts',
      platform: 'excel',
    },
  },
];

async function seed() {
  console.log(`Seeding ${agents.length} agents for owner ${ownerId}...\n`);

  for (const agent of agents) {
    // Check if agent already exists
    const existing = await db.collection('surfaces')
      .where('name', '==', agent.name)
      .where('ownerId', '==', ownerId)
      .limit(1).get();

    if (!existing.empty) {
      console.log(`  [skip] ${agent.name} — already exists (${existing.docs[0].id})`);
      continue;
    }

    const docRef = await db.collection('surfaces').add({
      name: agent.name,
      type: agent.type,
      status: 'idle',
      ownerId,
      capabilities: agent.capabilities,
      lastHeartbeat: null,
      currentTasks: [],
      metadata: agent.metadata,
    });

    console.log(`  [created] ${agent.name} → ${docRef.id}`);
  }

  console.log('\nDone! Surface IDs above can be used in connector configs.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
