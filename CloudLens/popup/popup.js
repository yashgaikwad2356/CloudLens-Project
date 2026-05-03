const KEYS = {
  templates: 'cloudlens_templates',
  activeId: 'cloudlens_active_template_id',
};

async function init() {
  const statusEl = document.getElementById('status');
  const data = await chrome.storage.local.get([KEYS.templates, KEYS.activeId]);
  const templates = data[KEYS.templates] || [];
  const activeId = data[KEYS.activeId];
  const active = templates.find((t) => t.id === activeId);
  if (!templates.length) {
    statusEl.textContent = 'Add an AI template in the dashboard to get started.';
  } else if (!active) {
    statusEl.textContent = `${templates.length} template(s) saved — activate one in the dashboard.`;
  } else {
    statusEl.textContent = `Active: ${active.name} (${active.provider})`;
  }

  document.getElementById('open-dash').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
