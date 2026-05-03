import { DEFAULT_ASSISTANT_SYSTEM, STRUCTURED_SYSTEM_PROMPT } from './prompts.js';

function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url.replace(/\/+$/, '');
}

function buildMessages(userMessages, structured) {
  const system = structured ? STRUCTURED_SYSTEM_PROMPT : DEFAULT_ASSISTANT_SYSTEM;
  return [{ role: 'system', content: system }, ...userMessages];
}

async function openAICompatibleFetch(url, apiKey, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = data.error?.message || data.message || text || res.statusText;
    throw new Error(err || `HTTP ${res.status}`);
  }
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? '';
  return { content: typeof content === 'string' ? content : JSON.stringify(content), raw: data };
}

export async function complete(template, userMessages, options = {}) {
  const { structured = false, maxTokensOverride } = options;
  const temperature = Number(template.temperature ?? 0.3);
  const max_tokens = Number(maxTokensOverride ?? template.maxTokens ?? 2048);
  const model = template.model || 'gpt-4o-mini';
  const apiKey = template.apiKey || '';
  if (!apiKey) throw new Error('API key is missing for this template.');

  const messages = buildMessages(userMessages, structured);

  const provider = template.provider;

  if (provider === 'openai' || provider === 'openai-compatible') {
    const base = normalizeBaseUrl(
      provider === 'openai' ? 'https://api.openai.com/v1' : template.baseUrl || 'https://api.openai.com/v1'
    );
    const url = `${base}/chat/completions`;
    const body = { model, messages, temperature, max_tokens };
    return openAICompatibleFetch(url, apiKey, body);
  }

  if (provider === 'anthropic') {
    const url = 'https://api.anthropic.com/v1/messages';
    const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens,
        temperature,
        system: systemText || undefined,
        messages: anthropicMessages,
      }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = data.error?.message || text || res.statusText;
      throw new Error(err || `HTTP ${res.status}`);
    }
    const blocks = data.content || [];
    const out = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { content: out, raw: data };
  }

  if (provider === 'google') {
    const m = model.includes('/') ? model.split('/').pop() : model;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
    const url = `${endpoint}?key=${encodeURIComponent(apiKey)}`;

    const systemText = messages.filter((x) => x.role === 'system').map((x) => x.content).join('\n');
    const rest = messages.filter((x) => x.role !== 'system');
    const merged =
      (systemText ? `Instructions:\n${systemText}\n\n---\n\n` : '') +
      rest.map((msg) => `${msg.role}: ${msg.content}`).join('\n\n');

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: merged }] }],
        generationConfig: { temperature, maxOutputTokens: max_tokens },
      }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = data.error?.message || text || res.statusText;
      throw new Error(err || `HTTP ${res.status}`);
    }
    const cand = data.candidates?.[0];
    const outParts = cand?.content?.parts || [];
    const out = outParts.map((p) => p.text || '').join('');
    return { content: out, raw: data };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

export async function runTestPrompt(template) {
  const sampleUser = [
    {
      role: 'user',
      content:
        'Reply with a single short sentence confirming you are reachable. Mention cloud troubleshooting.',
    },
  ];
  const start = performance.now();
  const result = await complete(template, sampleUser, { structured: false, maxTokensOverride: 120 });
  const latencyMs = Math.round(performance.now() - start);
  return { ...result, latencyMs };
}
