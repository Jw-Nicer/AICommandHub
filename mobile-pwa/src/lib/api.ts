import { auth } from './firebase';

const API_BASE = process.env.NEXT_PUBLIC_CLOUD_FUNCTION_URL || 'http://localhost:5001';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'Request failed');
  return data as T;
}

async function apiGet<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'GET',
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'Request failed');
  return data as T;
}

export async function submitDecision(
  approvalId: string,
  decision: 'approved' | 'rejected' | 'modified',
  decisionNote?: string,
  modifications?: { instructions?: string }
) {
  return apiPost('decide', { approvalId, decision, decisionNote, modifications });
}

export async function batchDecide(
  decisions: { approvalId: string; decision: string; decisionNote?: string }[]
) {
  return apiPost('batchDecide', { decisions });
}

export async function getDashboard() {
  return apiGet('getDashboard');
}

export async function queryMemory(domain: string, keyPattern?: string) {
  return apiPost('queryMemory', { domain, keyPattern });
}

export async function writeMemory(
  domain: string,
  key: string,
  value: Record<string, unknown>,
  confidence?: number
) {
  return apiPost('writeMemory', { domain, key, value, confidence });
}

export async function deleteMemory(memoryId: string) {
  return apiPost('deleteMemory', { memoryId });
}

export async function getSettings() {
  return apiGet('getSettings');
}

export async function saveSettings(settings: Record<string, unknown>) {
  return apiPost('saveSettings', settings);
}

export async function analyzePatterns() {
  return apiPost('analyzePatterns', {});
}

export async function getRules() {
  return apiGet('getRules');
}

export async function toggleRule(ruleId: string, enabled: boolean) {
  return apiPost('toggleRule', { ruleId, enabled });
}

export async function getDigests() {
  return apiGet('getDigests');
}

export async function registerDevice(fcmToken: string, platform: string) {
  return apiPost('registerDevice', { fcmToken, platform });
}

export async function routeTask(
  title: string,
  description?: string,
  requiredCapabilities?: string[],
  priority?: number,
  dependsOn?: string[]
) {
  return apiPost('routeTask', { title, description, requiredCapabilities, priority, dependsOn });
}
