// POCP ChatGPT Bridge — Background Service Worker
// Handles Firebase communication for the content script

// Config is stored in chrome.storage.local
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['pocpConfig'], (result) => {
      resolve(result.pocpConfig || {});
    });
  });
}

async function getAuthToken(config) {
  // For the extension, auth token is obtained via the popup sign-in flow
  // and stored in chrome.storage.local
  return new Promise((resolve) => {
    chrome.storage.local.get(['pocpAuthToken'], (result) => {
      resolve(result.pocpAuthToken || null);
    });
  });
}

async function apiPost(endpoint, body) {
  const config = await getConfig();
  const token = await getAuthToken(config);

  if (!token) {
    throw new Error('Not authenticated. Open extension popup to sign in.');
  }

  if (!config.cloudFunctionUrl) {
    throw new Error('Not configured. Open extension popup to set Cloud Function URL.');
  }

  const res = await fetch(`${config.cloudFunctionUrl}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'pocp-submit') return false;

  handleSubmission(message)
    .then((result) => sendResponse({ success: true, result }))
    .catch((err) => sendResponse({ success: false, error: err.message }));

  return true; // Keep channel open for async response
});

async function handleSubmission(message) {
  const { action, title, domain, content } = message;
  const config = await getConfig();
  const surfaceId = config.surfaceId || null;

  switch (action) {
    case 'memory':
      return apiPost('writeMemory', {
        surfaceId,
        domain,
        key: title,
        value: { content: content.slice(0, 50000), source: 'chatgpt' },
        confidence: 0.8,
        agentName: 'chatgpt',
      });

    case 'approval':
      return apiPost('submitApproval', {
        agentName: 'chatgpt',
        surfaceId,
        title,
        description: content.slice(0, 5000),
        diffPayload: {
          type: 'document',
          structuredData: {
            fullContent: content,
            source: 'chatgpt',
            domain,
          },
        },
        riskLevel: 'medium',
        requiresApprovalBefore: 'execute',
      });

    case 'task':
      return apiPost('assignTask', {
        title,
        description: content.slice(0, 5000),
        assignedSurface: surfaceId || '',
        priority: 3,
        metadata: { source: 'chatgpt', domain },
      });

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
