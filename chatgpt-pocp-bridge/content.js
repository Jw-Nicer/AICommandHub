// POCP ChatGPT Bridge — Content Script
// Injects "→ POCP" button on assistant messages and provides a modal for sending to the control plane

(function () {
  'use strict';

  const BUTTON_CLASS = 'pocp-bridge-btn';
  const MODAL_ID = 'pocp-bridge-modal';

  // Create the modal (injected once, reused)
  function createModal() {
    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="pocp-modal-overlay">
        <div class="pocp-modal-content">
          <h3 class="pocp-modal-title">Send to POCP</h3>

          <label class="pocp-label">Action</label>
          <select id="pocp-action" class="pocp-input">
            <option value="memory">Save to Memory</option>
            <option value="approval">Submit for Approval</option>
            <option value="task">Create Task Note</option>
          </select>

          <label class="pocp-label">Title / Key</label>
          <input type="text" id="pocp-title" class="pocp-input" placeholder="e.g., api:auth:strategy" />

          <label class="pocp-label">Domain</label>
          <select id="pocp-domain" class="pocp-input">
            <option value="project">Project</option>
            <option value="codebase">Codebase</option>
            <option value="decision">Decision</option>
            <option value="context">Context</option>
          </select>

          <div id="pocp-content-preview" class="pocp-preview"></div>

          <div class="pocp-modal-actions">
            <button id="pocp-cancel" class="pocp-btn pocp-btn-cancel">Cancel</button>
            <button id="pocp-submit" class="pocp-btn pocp-btn-submit">Send</button>
          </div>

          <div id="pocp-status" class="pocp-status"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('pocp-cancel').addEventListener('click', hideModal);
    document.getElementById('pocp-submit').addEventListener('click', handleSubmit);
    modal.querySelector('.pocp-modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) hideModal();
    });
  }

  function showModal(content) {
    createModal();
    const modal = document.getElementById(MODAL_ID);
    modal.style.display = 'block';
    modal.dataset.content = content;

    // Show preview (first 300 chars)
    const preview = document.getElementById('pocp-content-preview');
    preview.textContent = content.slice(0, 300) + (content.length > 300 ? '...' : '');

    document.getElementById('pocp-title').value = '';
    document.getElementById('pocp-status').textContent = '';
  }

  function hideModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
  }

  async function handleSubmit() {
    const modal = document.getElementById(MODAL_ID);
    const content = modal.dataset.content;
    const action = document.getElementById('pocp-action').value;
    const title = document.getElementById('pocp-title').value;
    const domain = document.getElementById('pocp-domain').value;
    const statusEl = document.getElementById('pocp-status');

    if (!title) {
      statusEl.textContent = 'Title / Key is required';
      statusEl.className = 'pocp-status pocp-status-error';
      return;
    }

    statusEl.textContent = 'Sending...';
    statusEl.className = 'pocp-status';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'pocp-submit',
        action,
        title,
        domain,
        content,
      });

      if (response.success) {
        statusEl.textContent = 'Sent successfully!';
        statusEl.className = 'pocp-status pocp-status-success';
        setTimeout(hideModal, 1500);
      } else {
        statusEl.textContent = `Error: ${response.error}`;
        statusEl.className = 'pocp-status pocp-status-error';
      }
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'pocp-status pocp-status-error';
    }
  }

  // Add POCP button to assistant messages
  function addButtonToMessage(messageEl) {
    if (messageEl.querySelector(`.${BUTTON_CLASS}`)) return;

    const btn = document.createElement('button');
    btn.className = BUTTON_CLASS;
    btn.textContent = '→ POCP';
    btn.title = 'Send to Parallel Operations Control Plane';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const content = messageEl.innerText || messageEl.textContent || '';
      showModal(content);
    });

    // Find the action bar or append to message
    const actionBar = messageEl.querySelector('[class*="flex"][class*="gap"]');
    if (actionBar) {
      actionBar.appendChild(btn);
    } else {
      messageEl.appendChild(btn);
    }
  }

  // Observe for new messages
  function scanMessages() {
    // ChatGPT assistant messages — try common selectors
    const selectors = [
      '[data-message-author-role="assistant"]',
      '.agent-turn',
      '[class*="markdown"]',
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => {
        addButtonToMessage(el);
      });
    }
  }

  // Watch for DOM changes (new messages)
  const observer = new MutationObserver(() => {
    scanMessages();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial scan
  scanMessages();
})();
