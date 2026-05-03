const KEYS = {
  templates: 'cloudlens_templates',
  activeId: 'cloudlens_active_template_id',
  activity: 'cloudlens_activity_log',
  errors: 'cloudlens_error_log',
};

const titles = {
  overview: 'Dashboard',
  templates: 'Templates',
  test: 'Test Connection',
  monitor: 'Error Monitor',
};

function el(id) {
  return document.getElementById(id);
}

async function loadTemplates() {
  const data = await chrome.storage.local.get([KEYS.templates, KEYS.activeId, KEYS.activity, KEYS.errors]);
  return {
    templates: data[KEYS.templates] || [],
    activeId: data[KEYS.activeId] || null,
    activity: data[KEYS.activity] || [],
    errors: data[KEYS.errors] || [],
  };
}

async function saveTemplates(templates) {
  await chrome.storage.local.set({ [KEYS.templates]: templates });
}

async function setActive(id) {
  await chrome.storage.local.set({ [KEYS.activeId]: id });
}

async function pushActivity(entry) {
  const data = await chrome.storage.local.get(KEYS.activity);
  const list = data[KEYS.activity] || [];
  list.unshift({ ...entry, t: Date.now() });
  await chrome.storage.local.set({ [KEYS.activity]: list.slice(0, 50) });
}

function uuid() {
  return crypto.randomUUID();
}

function toggleBaseUrlVisibility() {
  const prov = el('field-provider').value;
  el('wrap-baseurl').classList.toggle('hidden', prov !== 'openai-compatible');
}

function renderTemplateList(templates, activeId) {
  const ul = el('template-list');
  ul.innerHTML = '';
  if (!templates.length) {
    ul.innerHTML = '<li class="muted">No templates yet. Add one on the right.</li>';
    return;
  }
  for (const t of templates) {
    const li = document.createElement('li');
    li.className = 'template-item' + (t.id === activeId ? ' active' : '');
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(t.name)}</strong>
        <div class="template-meta">${escapeHtml(t.provider)} · ${escapeHtml(t.model)}</div>
      </div>
      <div class="template-actions">
        <button type="button" class="btn ghost" data-act="edit" data-id="${t.id}">Edit</button>
        <button type="button" class="btn primary" data-act="activate" data-id="${t.id}">Activate</button>
        <button type="button" class="btn danger" data-act="delete" data-id="${t.id}">Delete</button>
      </div>
    `;
    ul.appendChild(li);
  }

  ul.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const act = btn.getAttribute('data-act');
      const { templates: ts } = await loadTemplates();
      const t = ts.find((x) => x.id === id);
      if (!t) return;
      if (act === 'edit') {
        fillForm(t);
        el('form-title').textContent = 'Edit template';
      }
      if (act === 'activate') {
        await setActive(id);
        await pushActivity({ type: 'activate', summary: `Activated “${t.name}”` });
        await refresh();
      }
      if (act === 'delete') {
        if (!confirm(`Delete template “${t.name}”?`)) return;
        const next = ts.filter((x) => x.id !== id);
        await saveTemplates(next);
        const { activeId: cur } = await loadTemplates();
        if (cur === id) await chrome.storage.local.remove(KEYS.activeId);
        await pushActivity({ type: 'delete', summary: `Deleted “${t.name}”` });
        resetForm();
        await refresh();
      }
    });
  });
}

function fillForm(t) {
  el('field-id').value = t.id;
  el('field-name').value = t.name;
  el('field-provider').value = t.provider;
  el('field-model').value = t.model;
  el('field-key').value = t.apiKey || '';
  el('field-baseurl').value = t.baseUrl || '';
  el('field-temp').value = t.temperature ?? 0.3;
  el('field-max').value = t.maxTokens ?? 2048;
  toggleBaseUrlVisibility();
}

function resetForm() {
  el('template-form').reset();
  el('field-id').value = '';
  el('form-title').textContent = 'New template';
  toggleBaseUrlVisibility();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTestSelect(templates) {
  const sel = el('test-template-select');
  sel.innerHTML = '';
  for (const t of templates) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.name} (${t.provider})`;
    sel.appendChild(o);
  }
  if (!templates.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Save a template first';
    sel.appendChild(o);
    el('btn-test').disabled = true;
  } else {
    el('btn-test').disabled = false;
  }
}

function renderOverview({ templates, activeId, activity, errors }) {
  const active = templates.find((t) => t.id === activeId);
  el('dash-template-count').textContent = `${templates.length} saved`;
  if (active) {
    el('dash-active').textContent = `${active.name} — ${active.model}`;
    el('dash-provider').textContent = `Provider: ${active.provider}`;
  } else {
    el('dash-active').textContent = 'No template activated.';
    el('dash-provider').textContent = '';
  }

  const actUl = el('activity-list');
  actUl.innerHTML = '';
  if (!activity.length) {
    actUl.innerHTML = '<li class="muted">No recent actions yet.</li>';
  } else {
    for (const a of activity.slice(0, 12)) {
      const li = document.createElement('li');
      const d = new Date(a.t);
      li.textContent = `${d.toLocaleString()}: ${a.summary || a.type}`;
      actUl.appendChild(li);
    }
  }

  const errUl = el('error-summaries');
  errUl.innerHTML = '';
  if (!errors.length) {
    errUl.innerHTML = '<li class="muted">No captured errors in this browser yet.</li>';
  } else {
    for (const e of errors.slice(0, 8)) {
      const li = document.createElement('li');
      li.textContent = `${new Date(e.t).toLocaleString()}: ${(e.snippet || '').slice(0, 120)}…`;
      errUl.appendChild(li);
    }
  }
}

async function refresh() {
  const state = await loadTemplates();
  renderTemplateList(state.templates, state.activeId);
  renderTestSelect(state.templates);
  renderOverview(state);

  const pill = el('conn-pill');
  const active = state.templates.find((t) => t.id === state.activeId);
  if (!active) {
    pill.textContent = 'No active template';
    pill.className = 'pill pill-warn';
  } else {
    pill.textContent = `Active: ${active.name}`;
    pill.className = 'pill pill-ok';
  }
}

function navigate(section) {
  document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  el(`section-${section}`).classList.add('active');
  document.querySelector(`[data-section="${section}"]`).classList.add('active');
  el('page-title').textContent = titles[section] || 'CloudLens';
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => navigate(btn.getAttribute('data-section')));
});

document.querySelectorAll('[data-jump]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(a.getAttribute('data-jump'));
  });
});

el('field-provider').addEventListener('change', toggleBaseUrlVisibility);

el('template-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { templates } = await loadTemplates();
  const id = el('field-id').value || uuid();
  const name = el('field-name').value.trim();
  const provider = el('field-provider').value;
  const model = el('field-model').value.trim();
  const apiKey = el('field-key').value;
  const baseUrl = el('field-baseurl').value.trim();
  const temperature = parseFloat(el('field-temp').value) || 0.3;
  const maxTokens = parseInt(el('field-max').value, 10) || 2048;

  const record = {
    id,
    name,
    provider,
    model,
    apiKey,
    baseUrl: provider === 'openai-compatible' ? baseUrl : '',
    temperature,
    maxTokens,
  };

  const idx = templates.findIndex((t) => t.id === id);
  let next;
  if (idx >= 0) {
    next = [...templates];
    const prev = next[idx];
    next[idx] = { ...record, apiKey: apiKey || prev.apiKey };
  } else {
    next = [...templates, record];
  }

  await saveTemplates(next);
  await pushActivity({ type: 'save', summary: `Saved template “${name}”` });
  resetForm();
  await refresh();
});

el('btn-reset-form').addEventListener('click', () => resetForm());

el('btn-test').addEventListener('click', async () => {
  const sel = el('test-template-select');
  const id = sel.value;
  el('test-results').classList.remove('hidden');
  el('test-status').textContent = 'Testing…';
  el('test-latency').textContent = '—';
  el('test-validation').textContent = '—';
  el('test-output').textContent = '';

  const res = await chrome.runtime.sendMessage({ type: 'CLOUDLENS_LLM_TEST', templateId: id });
  if (!res.ok) {
    el('test-status').textContent = 'Failed';
    el('test-validation').textContent = res.error || 'Error';
    el('test-output').textContent = '';
    return;
  }
  el('test-status').textContent = res.connection || 'connected';
  el('test-latency').textContent = `${res.latencyMs} ms`;
  el('test-validation').textContent = res.validation || 'OK';
  el('test-output').textContent = res.sampleOutput || '';
  await pushActivity({ type: 'test', summary: `Connection test OK (${res.latencyMs} ms)` });
  await refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[KEYS.templates] || changes[KEYS.activeId] || changes[KEYS.activity] || changes[KEYS.errors]) {
    refresh();
  }
});

toggleBaseUrlVisibility();
refresh();
