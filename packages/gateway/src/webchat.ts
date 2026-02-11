import type { FastifyInstance } from 'fastify';
import { createLogger } from '@vena/shared';

const log = createLogger('gateway:webchat');

export function registerWebChat(app: FastifyInstance): void {
  log.info('Registering WebChat route');

  app.get('/chat', async (_request, reply) => {
    reply.type('text/html').send(getWebChatHTML());
  });
}

function getWebChatHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vena Chat</title>
  <style>
    :root {
      --vena-primary: #FF6B2B;
      --vena-gold: #FF9F1C;
      --vena-deep: #FF4500;
      --bg-dark: #0D1117;
      --bg-card: #161B22;
      --bg-input: #0D1117;
      --text-primary: #E6EDF3;
      --text-muted: #8B949E;
      --border-color: #30363D;
      --msg-user: #1C2128;
      --msg-assistant: #161B22;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
      background: var(--bg-dark);
      color: var(--text-primary);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .header {
      background: linear-gradient(135deg, var(--vena-deep) 0%, var(--vena-primary) 100%);
      padding: 0.75rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      z-index: 10;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-icon {
      width: 32px; height: 32px;
      background: white;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 1.2rem;
      color: var(--vena-primary);
    }

    .logo-text {
      font-size: 1.25rem;
      font-weight: 700;
      color: white;
    }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: rgba(255,255,255,0.9);
      font-size: 0.85rem;
    }

    .status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #3FB950;
      animation: pulse 2s infinite;
    }

    .status-dot.disconnected { background: #F85149; animation: none; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .character-select {
      background: rgba(255,255,255,0.15);
      border: 1px solid rgba(255,255,255,0.2);
      color: white;
      padding: 0.3rem 0.5rem;
      border-radius: 6px;
      font-size: 0.85rem;
      cursor: pointer;
      outline: none;
    }

    .character-select option { background: var(--bg-card); color: var(--text-primary); }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 0;
      scroll-behavior: smooth;
    }

    .messages::-webkit-scrollbar { width: 6px; }
    .messages::-webkit-scrollbar-track { background: transparent; }
    .messages::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }

    .message {
      max-width: 800px;
      margin: 0 auto;
      padding: 0.75rem 1.5rem;
      display: flex;
      gap: 0.75rem;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .message-avatar {
      width: 32px; height: 32px;
      border-radius: 6px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 0.85rem;
    }

    .message.user .message-avatar {
      background: var(--border-color);
      color: var(--text-primary);
    }

    .message.assistant .message-avatar {
      background: var(--vena-primary);
      color: white;
    }

    .message-content {
      flex: 1;
      min-width: 0;
    }

    .message-role {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 0.25rem;
    }

    .message-text {
      line-height: 1.6;
      word-wrap: break-word;
      white-space: pre-wrap;
    }

    .message-text code {
      background: rgba(255,255,255,0.08);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.9em;
    }

    .message-text pre {
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1rem;
      overflow-x: auto;
      margin: 0.5rem 0;
    }

    .message-text pre code {
      background: transparent;
      padding: 0;
    }

    .typing-indicator {
      max-width: 800px;
      margin: 0 auto;
      padding: 0.5rem 1.5rem;
      display: none;
      gap: 0.75rem;
      align-items: center;
    }

    .typing-indicator.visible { display: flex; }

    .typing-dots {
      display: flex;
      gap: 4px;
    }

    .typing-dots span {
      width: 6px; height: 6px;
      background: var(--vena-primary);
      border-radius: 50%;
      animation: typingBounce 1.4s infinite;
    }

    .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .typing-dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes typingBounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-6px); }
    }

    .input-area {
      flex-shrink: 0;
      border-top: 1px solid var(--border-color);
      padding: 1rem;
      background: var(--bg-card);
    }

    .input-container {
      max-width: 800px;
      margin: 0 auto;
      display: flex;
      gap: 0.75rem;
      align-items: flex-end;
    }

    .input-wrapper {
      flex: 1;
      background: var(--bg-input);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 0.5rem;
      transition: border-color 0.2s;
    }

    .input-wrapper:focus-within {
      border-color: var(--vena-primary);
    }

    #message-input {
      width: 100%;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-size: 0.95rem;
      line-height: 1.5;
      resize: none;
      outline: none;
      max-height: 150px;
      min-height: 24px;
      font-family: inherit;
      padding: 0.25rem 0.5rem;
    }

    #message-input::placeholder {
      color: var(--text-muted);
    }

    .send-btn {
      width: 40px; height: 40px;
      background: var(--vena-primary);
      border: none;
      border-radius: 10px;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, transform 0.1s;
      flex-shrink: 0;
    }

    .send-btn:hover { background: var(--vena-deep); }
    .send-btn:active { transform: scale(0.95); }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .send-btn svg {
      width: 20px; height: 20px;
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1.5rem;
      color: var(--text-muted);
      max-width: 500px;
      margin: auto;
    }

    .empty-state h2 {
      color: var(--vena-primary);
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }

    .session-info {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-align: center;
      padding: 0.25rem;
    }

    @media (max-width: 640px) {
      .message { padding: 0.5rem 1rem; }
      .input-container { gap: 0.5rem; }
      .header { padding: 0.5rem 1rem; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div class="logo-icon">V</div>
      <div class="logo-text">Vena</div>
    </div>
    <div style="display:flex; align-items:center; gap:1rem;">
      <select class="character-select" id="character-select">
        <option value="">Default</option>
        <option value="nova">Nova</option>
        <option value="sage">Sage</option>
        <option value="spark">Spark</option>
        <option value="ghost">Ghost</option>
        <option value="atlas">Atlas</option>
      </select>
      <div class="status-indicator">
        <div class="status-dot" id="status-dot"></div>
        <span id="status-text">Connecting...</span>
      </div>
    </div>
  </div>

  <div class="messages" id="messages">
    <div class="empty-state" id="empty-state">
      <h2>Welcome to Vena</h2>
      <p>Start a conversation with your AI agent. Messages are processed in real-time via WebSocket.</p>
    </div>
  </div>

  <div class="typing-indicator" id="typing-indicator">
    <div class="message-avatar" style="background:var(--vena-primary);color:white;width:24px;height:24px;font-size:0.7rem;">V</div>
    <div class="typing-dots"><span></span><span></span><span></span></div>
  </div>

  <div class="input-area">
    <div class="input-container">
      <div class="input-wrapper">
        <textarea id="message-input" placeholder="Send a message..." rows="1"></textarea>
      </div>
      <button class="send-btn" id="send-btn" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
    <div class="session-info" id="session-info"></div>
  </div>

  <script>
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const typingIndicator = document.getElementById('typing-indicator');
    const emptyState = document.getElementById('empty-state');
    const characterSelect = document.getElementById('character-select');
    const sessionInfo = document.getElementById('session-info');

    let ws = null;
    let sessionKey = localStorage.getItem('vena-session-key') || '';
    let messageHistory = [];

    // Load from localStorage
    try {
      const saved = localStorage.getItem('vena-chat-history');
      if (saved) {
        messageHistory = JSON.parse(saved);
        renderHistory();
      }
    } catch {}

    // Restore character
    const savedChar = localStorage.getItem('vena-character');
    if (savedChar) characterSelect.value = savedChar;

    characterSelect.addEventListener('change', () => {
      localStorage.setItem('vena-character', characterSelect.value);
    });

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host);

      ws.addEventListener('open', () => {
        statusDot.classList.remove('disconnected');
        statusText.textContent = 'Connected';
        sendBtn.disabled = false;
      });

      ws.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'response') {
            hideTyping();
            if (!sessionKey) {
              sessionKey = data.sessionKey;
              localStorage.setItem('vena-session-key', sessionKey);
              updateSessionInfo();
            }
            addMessage('assistant', data.content);
          } else if (data.type === 'error') {
            hideTyping();
            addMessage('assistant', 'Error: ' + data.error);
          }
        } catch {}
      });

      ws.addEventListener('close', () => {
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Disconnected';
        sendBtn.disabled = true;
        setTimeout(connect, 3000);
      });

      ws.addEventListener('error', () => {
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Error';
      });
    }

    function addMessage(role, text) {
      if (emptyState) emptyState.style.display = 'none';

      messageHistory.push({ role, text, time: Date.now() });
      saveHistory();

      const div = document.createElement('div');
      div.className = 'message ' + role;

      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = role === 'user' ? 'U' : 'V';

      const content = document.createElement('div');
      content.className = 'message-content';

      const roleLabel = document.createElement('div');
      roleLabel.className = 'message-role';
      roleLabel.textContent = role === 'user' ? 'You' : 'Vena';

      const msgText = document.createElement('div');
      msgText.className = 'message-text';
      msgText.textContent = text;

      content.appendChild(roleLabel);
      content.appendChild(msgText);
      div.appendChild(avatar);
      div.appendChild(content);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderHistory() {
      if (messageHistory.length === 0) return;
      if (emptyState) emptyState.style.display = 'none';

      for (const msg of messageHistory) {
        const div = document.createElement('div');
        div.className = 'message ' + msg.role;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = msg.role === 'user' ? 'U' : 'V';

        const content = document.createElement('div');
        content.className = 'message-content';

        const roleLabel = document.createElement('div');
        roleLabel.className = 'message-role';
        roleLabel.textContent = msg.role === 'user' ? 'You' : 'Vena';

        const msgText = document.createElement('div');
        msgText.className = 'message-text';
        msgText.textContent = msg.text;

        content.appendChild(roleLabel);
        content.appendChild(msgText);
        div.appendChild(avatar);
        div.appendChild(content);
        messagesEl.appendChild(div);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() { typingIndicator.classList.add('visible'); }
    function hideTyping() { typingIndicator.classList.remove('visible'); }

    function saveHistory() {
      try {
        // Keep last 100 messages
        const trimmed = messageHistory.slice(-100);
        localStorage.setItem('vena-chat-history', JSON.stringify(trimmed));
      } catch {}
    }

    function updateSessionInfo() {
      if (sessionKey) {
        sessionInfo.textContent = 'Session: ' + sessionKey;
      }
    }

    function sendMessage() {
      const text = inputEl.value.trim();
      if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

      addMessage('user', text);
      showTyping();

      const msg = { type: 'message', content: text };
      if (characterSelect.value) {
        msg.character = characterSelect.value;
      }
      ws.send(JSON.stringify(msg));

      inputEl.value = '';
      inputEl.style.height = 'auto';
    }

    sendBtn.addEventListener('click', sendMessage);

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px';
    });

    updateSessionInfo();
    connect();
  </script>
</body>
</html>`;
}
