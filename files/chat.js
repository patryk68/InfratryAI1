// ═══════════════════════════════════════
//  InfratryAI · Chat Engine v2 (Streaming)
// ═══════════════════════════════════════

const PROXY_URL  = '/api/chat';
const STATUS_URL = '/api/status';

const MODELS = {
  'tytanium-3.7': { label: 'Tytanium 3.7', color: 'blue',   backend: 'deepseek-r1:671b',  context: '128k ctx' },
  'thinking-2.4': { label: 'Thinking 2.4', color: 'purple', backend: 'minimax-text-01',   context: '64k ctx'  },
  'quantum-1.9':  { label: 'Quantum 1.9',  color: 'teal',   backend: 'qwen2.5:72b',       context: '32k ctx'  },
};

// ── State ──
let currentModel = 'tytanium-3.7';
let messages     = [];
let isStreaming   = false;
let abortCtrl    = null;
let msgCount     = 0;

// ── DOM ──
const feed       = document.getElementById('messages-feed');
const emptyState = document.getElementById('empty-state');
const textarea   = document.getElementById('msg-textarea');
const sendBtn    = document.getElementById('send-btn');
const messagesArea = document.getElementById('messages-area');
const scrollBtn  = document.getElementById('scroll-btn');
const msgCountEl = document.getElementById('msg-count');
const navModelName = document.getElementById('nav-model-name');
const navModelDot  = document.getElementById('nav-model-dot');

// ── Boot ──
initModelTabs();
initStarterCards();
initTextarea();
initScrollWatcher();
checkStatus();
setInterval(checkStatus, 30_000);

// ── Model tabs ──
function initModelTabs() {
  document.querySelectorAll('.model-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (isStreaming) return;
      const m = tab.dataset.model;
      if (m === currentModel) return;
      currentModel = m;

      document.querySelectorAll('.model-tab').forEach(t => {
        t.classList.remove('active', 'blue', 'purple', 'teal');
      });
      tab.classList.add('active', tab.dataset.color);

      // Update nav pill
      navModelName.textContent = MODELS[m].label;
      navModelDot.style.background =
        m === 'tytanium-3.7' ? 'var(--a-blue)' :
        m === 'thinking-2.4' ? 'var(--a-purple)' : 'var(--a-teal)';

      // Update context badge
      msgCountEl.textContent = MODELS[m].context + (msgCount ? ` · ${msgCount} wiad.` : '');
    });
  });
}

function initStarterCards() {
  document.querySelectorAll('.starter-card').forEach(card => {
    card.addEventListener('click', () => {
      textarea.value = card.dataset.prompt;
      autoResize();
      textarea.focus();
    });
  });
}

function initTextarea() {
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) stopStream();
      else             handleSend();
    }
  });
  textarea.addEventListener('input', autoResize);
  sendBtn.addEventListener('click', () => {
    if (isStreaming) stopStream();
    else             handleSend();
  });
}

function autoResize() {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
}

function initScrollWatcher() {
  messagesArea.addEventListener('scroll', () => {
    const dist = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight;
    scrollBtn.classList.toggle('visible', dist > 120);
  });
}

// ── Status ──
async function checkStatus() {
  const dot  = document.getElementById('nav-status-dot');
  const text = document.getElementById('nav-status-text');
  try {
    const r = await fetch(STATUS_URL, { signal: AbortSignal.timeout(5000) });
    dot.className  = 'nav-status-dot' + (r.ok ? '' : ' offline');
    text.textContent = r.ok ? 'Online' : 'Offline';
  } catch {
    dot.className  = 'nav-status-dot offline';
    text.textContent = 'Offline';
  }
}

// ── Clear chat ──
function clearChat() {
  messages   = [];
  msgCount   = 0;
  feed.innerHTML = '';
  feed.appendChild(emptyState);
  emptyState.style.display = '';
  msgCountEl.textContent = MODELS[currentModel].context;
  textarea.value = '';
  autoResize();
}

// ── Send ──
async function handleSend() {
  const text = textarea.value.trim();
  if (!text || isStreaming) return;

  // Hide empty state
  emptyState.style.display = 'none';

  textarea.value = '';
  autoResize();

  // Add user message to history + DOM
  messages.push({ role: 'user', content: text });
  msgCount++;
  renderUserMsg(text);
  updateMsgCount();

  // Start streaming
  isStreaming = true;
  setSendMode('stop');
  abortCtrl = new AbortController();

  const thinkingEl = renderThinking();
  let fullReply    = '';
  let aiBubble     = null;

  try {
    const res = await fetch(PROXY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: currentModel, messages: [...messages] }),
      signal:  abortCtrl.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    thinkingEl.remove();
    aiBubble = renderAiBubble();

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          const token = chunk?.message?.content ?? chunk?.response ?? '';
          if (token) {
            fullReply += token;
            aiBubble.innerHTML = mdToHtml(fullReply) + '<span class="stream-cursor"></span>';
            scrollToBottom();
          }
          if (chunk.done) break;
        } catch { /* partial JSON – skip */ }
      }
    }

  } catch (err) {
    thinkingEl?.remove();
    if (err.name === 'AbortError') {
      if (aiBubble && fullReply) fullReply += '\n\n_(Przerwano przez użytkownika)_';
    } else {
      if (!aiBubble) aiBubble = renderAiBubble();
      fullReply = '⚠️ Błąd połączenia z backendem. Sprawdź czy serwer proxy jest uruchomiony.';
      console.error('Stream error:', err);
    }
  } finally {
    if (aiBubble) {
      aiBubble.innerHTML = mdToHtml(fullReply || '_(Brak odpowiedzi)_');
      attachCopyButtons(aiBubble);
    }
    if (fullReply) {
      messages.push({ role: 'assistant', content: fullReply });
      msgCount++;
      updateMsgCount();
    }
    isStreaming = false;
    abortCtrl   = null;
    setSendMode('send');
    scrollToBottom();
  }
}

function stopStream() {
  abortCtrl?.abort();
}

// ── Render helpers ──
function renderUserMsg(text) {
  const row = document.createElement('div');
  row.className = 'msg-row user-row';

  const wrap = document.createElement('div');
  wrap.className = 'user-bubble-wrap';

  const bubble = document.createElement('div');
  bubble.className = 'user-bubble';
  bubble.textContent = text;

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = now();

  wrap.appendChild(bubble);
  wrap.appendChild(time);
  row.appendChild(wrap);
  feed.appendChild(row);
  scrollToBottom();
}

function renderThinking() {
  const row = document.createElement('div');
  row.className = 'thinking-row';
  row.innerHTML = `
    <div class="ai-avatar">AI</div>
    <div class="thinking-dots">
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
    </div>
    <span class="thinking-text">Generuję odpowiedź…</span>`;
  feed.appendChild(row);
  scrollToBottom();
  return row;
}

function renderAiBubble() {
  const info = MODELS[currentModel];
  const row  = document.createElement('div');
  row.className = 'msg-row ai-row';

  const colorMap = { blue: 'var(--a-blue)', purple: 'var(--a-purple)', teal: 'var(--a-teal)' };

  row.innerHTML = `
    <div class="ai-row-inner">
      <div class="ai-avatar" style="background:linear-gradient(135deg,${colorMap[info.color]},var(--a-purple))">AI</div>
      <div class="ai-content">
        <div class="ai-model-label">
          <span class="ai-model-label-dot" style="background:${colorMap[info.color]}"></span>
          ${info.label} · ${now()}
        </div>
        <div class="ai-text" id="ai-text-${Date.now()}"></div>
        <div class="ai-actions">
          <button class="ai-action-btn copy-all-btn" title="Kopiuj">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Kopiuj
          </button>
          <button class="ai-action-btn regen-btn" title="Wygeneruj ponownie">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
            Ponów
          </button>
        </div>
      </div>
    </div>`;

  feed.appendChild(row);

  // Wire up copy-all
  const copyAllBtn = row.querySelector('.copy-all-btn');
  const aiTextEl   = row.querySelector('.ai-text');

  copyAllBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(aiTextEl.innerText).then(() => {
      copyAllBtn.textContent = '✓ Skopiowano';
      setTimeout(() => {
        copyAllBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Kopiuj`;
      }, 2000);
    });
  });

  // Wire up regen
  row.querySelector('.regen-btn').addEventListener('click', () => {
    if (isStreaming) return;
    // Remove last assistant message and re-trigger
    if (messages.at(-1)?.role === 'assistant') {
      messages.pop();
      msgCount--;
    }
    row.remove();
    // Re-send (will use existing messages array)
    regenFromHistory();
  });

  scrollToBottom();
  return aiTextEl;
}

async function regenFromHistory() {
  if (isStreaming || messages.length === 0) return;
  isStreaming = true;
  setSendMode('stop');
  abortCtrl = new AbortController();
  const thinkingEl = renderThinking();
  let fullReply = '';
  let aiBubble  = null;

  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: currentModel, messages: [...messages] }),
      signal: abortCtrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    thinkingEl.remove();
    aiBubble = renderAiBubble();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          const token = chunk?.message?.content ?? chunk?.response ?? '';
          if (token) { fullReply += token; aiBubble.innerHTML = mdToHtml(fullReply) + '<span class="stream-cursor"></span>'; scrollToBottom(); }
          if (chunk.done) break;
        } catch {}
      }
    }
  } catch(err) {
    thinkingEl?.remove();
    if (!aiBubble) aiBubble = renderAiBubble();
    if (err.name !== 'AbortError') fullReply = '⚠️ Błąd przy ponowieniu.';
  } finally {
    if (aiBubble) { aiBubble.innerHTML = mdToHtml(fullReply || '_(Brak odpowiedzi)_'); attachCopyButtons(aiBubble); }
    if (fullReply) { messages.push({ role: 'assistant', content: fullReply }); msgCount++; updateMsgCount(); }
    isStreaming = false; abortCtrl = null; setSendMode('send'); scrollToBottom();
  }
}

// ── Attach copy buttons to code blocks ──
function attachCopyButtons(container) {
  container.querySelectorAll('pre').forEach(pre => {
    const btn = pre.querySelector('.code-copy-btn');
    if (!btn) return;
    const code = pre.querySelector('code');
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(code.innerText).then(() => {
        btn.textContent = '✓ Skopiowano';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Kopiuj'; btn.classList.remove('copied'); }, 2000);
      });
    });
  });
}

// ── Markdown → HTML ──
function mdToHtml(md) {
  // Escape
  let s = md
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');

  // Fenced code blocks
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const l = lang || 'code';
    return `<pre><div class="code-header"><span class="code-lang">${l}</span><button class="code-copy-btn">Kopiuj</button></div><code>${code.trimEnd()}</code></pre>`;
  });

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Bold + italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Headings
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // Blockquote
  s = s.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered list
  s = s.replace(/(^[*\-] .+(\n[*\-] .+)*)/gm, match => {
    const items = match.split('\n').map(l => `<li>${l.replace(/^[*\-] /,'')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered list
  s = s.replace(/(^\d+\. .+(\n\d+\. .+)*)/gm, match => {
    const items = match.split('\n').map(l => `<li>${l.replace(/^\d+\. /,'')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // Horizontal rule
  s = s.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--b2);margin:16px 0">');

  // Paragraphs (double newline)
  s = s.replace(/\n\n/g, '</p><p>');
  s = `<p>${s}</p>`;

  // Single newlines inside paragraphs
  s = s.replace(/(?<!>)\n(?!<)/g, '<br>');

  // Clean up empty <p>
  s = s.replace(/<p><\/p>/g, '');
  s = s.replace(/<p>(<(?:pre|ul|ol|h[123]|blockquote|hr)[^>]*>)/g, '$1');
  s = s.replace(/(<\/(?:pre|ul|ol|h[123]|blockquote)>)<\/p>/g, '$1');

  return s;
}

// ── UI helpers ──
function setSendMode(mode) {
  if (mode === 'stop') {
    sendBtn.classList.add('stop-mode');
    sendBtn.title = 'Zatrzymaj';
    sendBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;
    textarea.disabled = true;
  } else {
    sendBtn.classList.remove('stop-mode');
    sendBtn.title = 'Wyślij';
    sendBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
    textarea.disabled = false;
    textarea.focus();
  }
}

function updateMsgCount() {
  const m = MODELS[currentModel];
  msgCountEl.textContent = msgCount
    ? `${m.context} · ${msgCount} wiad.`
    : m.context;
}

function scrollToBottom(force = false) {
  const area = messagesArea;
  const dist = area.scrollHeight - area.scrollTop - area.clientHeight;
  if (force || dist < 200) {
    area.scrollTop = area.scrollHeight;
  }
}

function now() {
  return new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}
