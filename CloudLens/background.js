import { complete, runTestPrompt } from './lib/llm.js';
import { isCloudLensPageUrl } from './lib/cloud-url.js';

const STORAGE_KEYS = {
  templates: 'cloudlens_templates',
  activeId: 'cloudlens_active_template_id',
};

async function getState() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.templates, STORAGE_KEYS.activeId]);
  const templates = data[STORAGE_KEYS.templates] || [];
  const activeTemplateId = data[STORAGE_KEYS.activeId] || null;
  return { templates, activeTemplateId };
}

function findTemplate(templates, id) {
  return templates.find((t) => t.id === id) || null;
}

function syncToolbarForTab(tab) {
  if (tab?.id == null) return;
  const raw = tab.url || tab.pendingUrl;
  if (!raw || (!raw.startsWith('http:') && !raw.startsWith('https:'))) {
    chrome.action.disable(tab.id);
    return;
  }
  const allowed = isCloudLensPageUrl(raw);
  if (allowed) chrome.action.enable(tab.id);
  else chrome.action.disable(tab.id);
}

async function syncToolbarForAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) syncToolbarForTab(tab);
  } catch {
    /* ignore */
  }
}

chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.status === 'complete' || info.url) syncToolbarForTab(tab);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (t) => {
    if (chrome.runtime.lastError || !t) return;
    syncToolbarForTab(t);
  });
});

chrome.runtime.onStartup.addListener(() => {
  syncToolbarForAllTabs();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async () => {
    try {
      if (message?.type === 'CLOUDLENS_PING') {
        return { ok: true };
      }

      if (message?.type === 'CLOUDLENS_GET_STATE') {
        return await getState();
      }

      if (message?.type === 'CLOUDLENS_LLM_TEST') {
        const { templates } = await getState();
        const tid = message.templateId;
        const template = findTemplate(templates, tid);
        if (!template) throw new Error('Template not found.');
        const { content, latencyMs, raw } = await runTestPrompt(template);
        return {
          ok: true,
          connection: 'connected',
          validation: 'API accepted the request.',
          latencyMs,
          sampleOutput: content,
          rawPreview: typeof raw === 'object' ? JSON.stringify(raw).slice(0, 500) : String(raw).slice(0, 500),
        };
      }

      if (message?.type === 'CLOUDLENS_LLM_CHAT') {
        const { templates, activeTemplateId } = await getState();
        const template = findTemplate(templates, activeTemplateId);
        if (!template) throw new Error('No active AI template. Open CloudLens dashboard and activate one.');
        const userMessages = message.messages || [];
        const structured = Boolean(message.structured);
        const start = performance.now();
        const { content, raw } = await complete(template, userMessages, { structured });
        const latencyMs = Math.round(performance.now() - start);
        return { ok: true, content, latencyMs, raw: undefined };
      }

      return { ok: false, error: 'Unknown message type.' };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  };

  handle().then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([STORAGE_KEYS.templates], (data) => {
    if (!data[STORAGE_KEYS.templates]) {
      chrome.storage.local.set({ [STORAGE_KEYS.templates]: [] });
    }
  });
  syncToolbarForAllTabs();
});

syncToolbarForAllTabs();
