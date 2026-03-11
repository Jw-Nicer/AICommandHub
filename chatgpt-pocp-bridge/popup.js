// POCP ChatGPT Bridge — Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('cloudFunctionUrl');
  const tokenInput = document.getElementById('authToken');
  const surfaceInput = document.getElementById('surfaceId');
  const saveBtn = document.getElementById('save');
  const statusEl = document.getElementById('status');

  // Load saved config
  chrome.storage.local.get(['pocpConfig', 'pocpAuthToken'], (result) => {
    const config = result.pocpConfig || {};
    if (config.cloudFunctionUrl) urlInput.value = config.cloudFunctionUrl;
    if (config.surfaceId) surfaceInput.value = config.surfaceId;
    if (result.pocpAuthToken) {
      tokenInput.value = '••••••••';
      statusEl.textContent = 'Connected';
      statusEl.className = 'connected';
    }
  });

  saveBtn.addEventListener('click', () => {
    const cloudFunctionUrl = urlInput.value.trim().replace(/\/$/, '');
    const authToken = tokenInput.value === '••••••••' ? null : tokenInput.value.trim();
    const surfaceId = surfaceInput.value.trim();

    if (!cloudFunctionUrl) {
      statusEl.textContent = 'Cloud Function URL is required';
      statusEl.className = 'error';
      return;
    }

    const config = { cloudFunctionUrl, surfaceId };
    const updates = { pocpConfig: config };

    if (authToken) {
      updates.pocpAuthToken = authToken;
    }

    chrome.storage.local.set(updates, () => {
      statusEl.textContent = 'Configuration saved!';
      statusEl.className = 'connected';

      // Test connection
      testConnection(cloudFunctionUrl, authToken || updates.pocpAuthToken);
    });
  });

  async function testConnection(url, token) {
    if (!token) return;
    try {
      const res = await fetch(`${url}/getDashboard`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        statusEl.textContent = 'Connected and verified!';
        statusEl.className = 'connected';
      } else {
        statusEl.textContent = `Connected but auth failed (${res.status})`;
        statusEl.className = 'error';
      }
    } catch (err) {
      statusEl.textContent = `Cannot reach server: ${err.message}`;
      statusEl.className = 'error';
    }
  }
});
