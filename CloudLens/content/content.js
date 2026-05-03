(function cloudLensContent() {
  try {
    if (window.self !== window.top) return;
  } catch {
    return;
  }
  if (document.documentElement.dataset.cloudlensInjected) return;
  document.documentElement.dataset.cloudlensInjected = '1';

  const STORAGE = {
    lastErrorHash: 'cloudlens_last_error_hash',
    errorLog: 'cloudlens_error_log',
  };
  const ERROR_DEDUPE_WINDOW_MS = 3 * 60 * 1000;

  const ERROR_RE =
    /error|failed|timeout|access denied|cannot connect|unauthorized|forbidden|exception|connection refused|internal server error/i;

  const ASK_POPUP_ID = 'cloudlens-ask-popup';

  const CSS = `
    :host, * { box-sizing: border-box; font-family: "Segoe UI", system-ui, -apple-system, sans-serif; }
    .wrap { pointer-events: none; position: fixed; inset: 0; z-index: 2147483647; }
    .fab {
      pointer-events: auto;
      position: fixed; right: 20px; bottom: 24px;
      width: 56px; height: 56px; border-radius: 18px;
      border: 1px solid rgba(96,165,250,0.45);
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      color: #fff; font-weight: 700; font-size: 13px;
      cursor: pointer; box-shadow: 0 16px 40px rgba(37,99,235,0.45);
      display: flex; align-items: center; justify-content: center;
      letter-spacing: 0.02em; transition: transform 0.15s ease, box-shadow 0.15s;
    }
    .fab:hover { transform: translateY(-2px); box-shadow: 0 20px 48px rgba(37,99,235,0.55); }
    .panel {
      pointer-events: auto;
      position: fixed; right: 20px; bottom: 92px; width: min(420px, calc(100vw - 40px));
      height: min(560px, calc(100vh - 120px));
      display: none; flex-direction: column;
      border-radius: 16px; overflow: hidden;
      border: 1px solid rgba(96,165,250,0.35);
      background: rgba(10,22,40,0.92); backdrop-filter: blur(16px);
      box-shadow: 0 24px 60px rgba(0,20,60,0.55);
      color: #e8f1ff;
    }
    .panel.open { display: flex; }
    .head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px; background: linear-gradient(90deg, rgba(59,130,246,0.25), transparent);
      border-bottom: 1px solid rgba(96,165,250,0.2);
    }
    .head strong { font-size: 14px; }
    .head button {
      border: none; background: transparent; color: #94a3b8; cursor: pointer; font-size: 18px; line-height: 1;
    }
    .messages {
      flex: 1; overflow: auto; padding: 12px 14px; gap: 10px; display: flex; flex-direction: column;
    }
    .bubble {
      padding: 10px 12px; border-radius: 12px; font-size: 13px; line-height: 1.45;
      border: 1px solid rgba(148,163,184,0.15);
      background: rgba(15,39,68,0.65);
    }
    .bubble.user { align-self: flex-end; background: rgba(59,130,246,0.25); border-color: rgba(96,165,250,0.35); }
    .bubble.assistant { align-self: stretch; }
    .bubble h3, .bubble h4 { margin: 0.4em 0 0.2em; font-size: 13px; color: #93c5fd; }
    .bubble code { background: rgba(0,0,0,0.35); padding: 1px 5px; border-radius: 6px; font-size: 12px; }
    .composer {
      display: flex; gap: 8px; padding: 10px; border-top: 1px solid rgba(96,165,250,0.2);
      background: rgba(6,14,28,0.85);
    }
    .composer textarea {
      flex: 1; resize: none; min-height: 44px; max-height: 120px;
      border-radius: 12px; border: 1px solid rgba(96,165,250,0.3);
      padding: 10px; background: rgba(5,12,28,0.85); color: #e8f1ff; font-size: 13px;
    }
    .composer button {
      align-self: flex-end; border: none; border-radius: 12px; padding: 0 16px; height: 44px;
      background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; font-weight: 600; cursor: pointer;
    }
    .composer button:disabled { opacity: 0.5; cursor: not-allowed; }
    .meta { font-size: 11px; color: #94a3b8; margin-top: 4px; }
  `;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMarkdownLite(md) {
    let s = escapeHtml(md);
    s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<pre style="white-space:pre-wrap;margin:8px 0;padding:10px;border-radius:10px;background:rgba(0,0,0,.35);border:1px solid rgba(96,165,250,.2);font-size:12px;">${escapeHtml(code.trim())}</pre>`);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    s = s.replace(/^- (.+)$/gm, '• $1<br/>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\n/g, '<br/>');
    return s;
  }

  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return String(h);
  }

  function extractErrorContext(fullText, matchIndex) {
    const radius = 380;
    const start = Math.max(0, fullText.lastIndexOf('\n', matchIndex - 1));
    const roughStart = Math.max(0, matchIndex - radius);
    const sliceStart = Math.min(start, roughStart);
    let end = fullText.indexOf('\n', matchIndex + 1);
    if (end < 0) end = fullText.length;
    while (end - sliceStart < 80 && end < fullText.length) {
      const next = fullText.indexOf('\n', end + 1);
      if (next < 0) break;
      end = next;
    }
    const sliceEnd = Math.min(fullText.length, sliceStart + radius * 2);
    return fullText.slice(sliceStart, sliceEnd).replace(/\s+/g, ' ').trim();
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  const host = document.createElement('div');
  host.id = 'cloudlens-host';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <button type="button" class="fab" title="CloudLens AI">CL</button>
    <div class="panel" aria-label="CloudLens chat">
      <div class="head">
        <strong>CloudLens</strong>
        <button type="button" aria-label="Close">&times;</button>
      </div>
      <div class="messages"></div>
      <div class="composer">
        <textarea rows="2" placeholder="Ask about this page, an error, or your cloud setup…"></textarea>
        <button type="button">Send</button>
      </div>
    </div>
  `;
  shadow.appendChild(styleEl);
  shadow.appendChild(wrap);

  const fab = wrap.querySelector('.fab');
  const panel = wrap.querySelector('.panel');
  const btnClose = wrap.querySelector('.head button');
  const messagesEl = wrap.querySelector('.messages');
  const textarea = wrap.querySelector('textarea');
  const btnSend = wrap.querySelector('.composer button');

  let selectionBtn = null;
  /** Plain text captured at mouseup (passed into Ask handler; never re-read from getSelection after mousedown). */
  let cachedHighlightText = '';
  let askPopupAutoRemoveTimer = null;
  let busy = false;
  const history = [];

  function setOpen(open) {
    panel.classList.toggle('open', open);
  }

  fab.addEventListener('click', () => {
    const next = !panel.classList.contains('open');
    setOpen(next);
  });
  btnClose.addEventListener('click', () => setOpen(false));

  function appendBubble(role, html, meta) {
    const div = document.createElement('div');
    div.className = `bubble ${role}`;
    div.innerHTML = html + (meta ? `<div class="meta">${escapeHtml(meta)}</div>` : '');
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function llmChat(userMessages, structured) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'CLOUDLENS_LLM_CHAT',
        messages: userMessages,
        structured,
      });
      if (!res) {
        return { ok: false, error: 'No response from CloudLens background service.' };
      }
      return res;
    } catch (error) {
      return {
        ok: false,
        error: error && error.message ? error.message : 'CloudLens background service is unavailable.',
      };
    }
  }

  async function sendUserMessage(text, structured) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    busy = true;
    btnSend.disabled = true;
    appendBubble('user', escapeHtml(trimmed).replace(/\n/g, '<br/>'));
    history.push({ role: 'user', content: trimmed });

    const payload = history.map((m) => ({ role: m.role, content: m.content }));
    const res = await llmChat(payload, structured);
    busy = false;
    btnSend.disabled = false;

    if (!res.ok) {
      appendBubble('assistant', `<span style="color:#fecaca">${escapeHtml(res.error || 'Request failed')}</span>`);
      history.pop();
      return;
    }
    history.push({ role: 'assistant', content: res.content });
    appendBubble('assistant', renderMarkdownLite(res.content), res.latencyMs ? `${res.latencyMs} ms` : '');
  }

  btnSend.addEventListener('click', () => {
    const v = textarea.value;
    textarea.value = '';
    sendUserMessage(v, false);
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const v = textarea.value;
      textarea.value = '';
      sendUserMessage(v, false);
    }
  });

  function hideSelectionButton() {
    if (askPopupAutoRemoveTimer != null) {
      clearTimeout(askPopupAutoRemoveTimer);
      askPopupAutoRemoveTimer = null;
    }
    document.getElementById(ASK_POPUP_ID)?.remove();
    selectionBtn = null;
    cachedHighlightText = '';
  }

  /**
   * Light-DOM Ask chip (same placement + look as former shadow .sel-btn; styles inline so content.css stays unchanged).
   */
  function showAskPopupNearSelection(rect, selectedPlainText) {
    hideSelectionButton();
    const text = (selectedPlainText || '').trim();
    if (!text) return;

    cachedHighlightText = text;
    selectionBtn = document.createElement('button');
    selectionBtn.id = ASK_POPUP_ID;
    selectionBtn.type = 'button';
    selectionBtn.textContent = 'Ask CloudLens AI';
    Object.assign(selectionBtn.style, {
      position: 'fixed',
      zIndex: '2147483646',
      top: `${rect.bottom + 6}px`,
      left: `${rect.left}px`,
      border: 'none',
      borderRadius: '10px',
      padding: '6px 10px',
      background: 'linear-gradient(135deg, #3b82f6, #0ea5e9)',
      color: '#fff',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 10px 28px rgba(14, 165, 233, 0.35)',
      fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
    });
    document.body.appendChild(selectionBtn);

    selectionBtn.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const t = cachedHighlightText.trim();
      hideSelectionButton();
      if (!t) return;
      setOpen(true);
      history.length = 0;
      messagesEl.innerHTML = '';
      textarea.value = t;
      requestAnimationFrame(() => textarea.focus());
      const prompt = `The user highlighted the following from the webpage:\n\n"""\n${t}\n"""\n\nExplain the terminology in the highlighted text.`;
      void sendUserMessage(prompt, true);
    });

    askPopupAutoRemoveTimer = window.setTimeout(() => hideSelectionButton(), 4000);
  }

  document.addEventListener('mouseup', (e) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      hideSelectionButton();
      return;
    }
    const t = String(sel.toString()).trim();
    if (t.length < 6) {
      hideSelectionButton();
      return;
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) {
      hideSelectionButton();
      return;
    }
    showAskPopupNearSelection(r, t);
  });

  document.addEventListener('mousedown', (e) => {
    if (!selectionBtn) return;
    if (e.target === selectionBtn || selectionBtn.contains(e.target)) return;
    window.setTimeout(() => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) hideSelectionButton();
    }, 0);
  });

  async function onNewErrorSnippet(snippet) {
    const norm = snippet.slice(0, 2000);
    const hash = simpleHash(norm);
    const now = Date.now();
    const host = location.hostname || '';
    const prevRaw = (await chrome.storage.local.get(STORAGE.lastErrorHash))[STORAGE.lastErrorHash];
    const prev =
      prevRaw && typeof prevRaw === 'object'
        ? prevRaw
        : {
            hash: typeof prevRaw === 'string' ? prevRaw : '',
            ts: 0,
            host: '',
          };

    const isSameError =
      prev.hash === hash && prev.host === host && now - Number(prev.ts || 0) < ERROR_DEDUPE_WINDOW_MS;
    if (isSameError) return;

    await chrome.storage.local.set({
      [STORAGE.lastErrorHash]: { hash, ts: now, host },
    });
    const log = (await chrome.storage.local.get(STORAGE.errorLog))[STORAGE.errorLog] || [];
    log.unshift({ t: Date.now(), snippet: norm });
    await chrome.storage.local.set({ [STORAGE.errorLog]: log.slice(0, 40) });

    setOpen(true);
    history.length = 0;
    messagesEl.innerHTML = '';
    await sendUserMessage(
      `A cloud-related error may have appeared on a webpage. Analyze the following excerpt and give a step by step guide to troubleshoot the error.\n\n"""\n${norm}\n"""`,
      true
    );
  }

  const scanErrors = debounce(() => {
    try {
      const txt = document.body ? document.body.innerText || '' : '';
      if (txt.length < 40) return;
      const slice = txt.length > 80000 ? txt.slice(0, 80000) : txt;
      const m = slice.match(ERROR_RE);
      if (!m || m.index === undefined) return;
      const ctx = extractErrorContext(slice, m.index);
      if (ctx.length < 24) return;
      onNewErrorSnippet(ctx);
    } catch {
      /* ignore */
    }
  }, 900);

  const mo = new MutationObserver(() => scanErrors());
  if (document.body) mo.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true, subtree: true }));

  document.addEventListener('readystatechange', () => scanErrors());
  scanErrors();
})();
