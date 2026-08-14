// =============================================================
// Tenant Chat Widget — AI Mode + Live Chat Mode
// =============================================================

const chatState = {
    isOpen:      false,
    mode:        'ai',      // 'ai' | 'live'
    history:     [],        // AI conversation history
    adminOnline: false,
    socket:      null,
    connecting:  false,     // guard: true while connectSocket() is in-flight
    tenantId:    null,
    tenantName:  null,
    roomNumber:  null,
    sessionId:   null
};

// ── Notification sound for incoming admin reply ──────────────────────────────
function playTenantNotification() {
    try {
        const ctx  = new (window.AudioContext || window.webkitAudioContext)();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type            = 'sine';
        osc.frequency.value = 740;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.55);
    } catch (_) {}
}

// ── Format timestamp ──────────────────────────────────────────────────────────
function formatChatTime(isoStr) {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Build UI ──────────────────────────────────────────────────────────────────
function initChatUI() {
    if (document.getElementById('chat-widget')) return;

    const chatHTML = `
        <!-- Chat Toggle Button -->
        <button id="chat-toggle-btn"
            style="position:fixed;bottom:30px;right:30px;width:60px;height:60px;z-index:1050;
                   background:linear-gradient(135deg,#4f46e5,#7c3aed);border:none;border-radius:50%;
                   cursor:pointer;box-shadow:0 6px 24px rgba(79,70,229,0.45);
                   display:flex;align-items:center;justify-content:center;transition:transform 0.2s;">
            <i class="fas fa-comment-dots" style="color:#fff;font-size:1.3rem;"></i>
            <span id="chat-unread-dot"
                style="display:none;position:absolute;top:4px;right:4px;width:12px;height:12px;
                       background:#ef4444;border-radius:50%;border:2px solid #fff;"></span>
        </button>

        <!-- Chat Window -->
        <div id="chat-widget" class="d-none"
            style="position:fixed;bottom:100px;right:30px;width:360px;height:520px;
                   z-index:1050;display:flex;flex-direction:column;
                   border-radius:20px;overflow:hidden;
                   box-shadow:0 16px 60px rgba(0,0,0,0.22);font-family:'Inter',sans-serif;">

            <!-- Header -->
            <div id="chat-header"
                style="padding:14px 16px;display:flex;align-items:center;gap:10px;
                       background:linear-gradient(135deg,#4f46e5,#7c3aed);">
                <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.2);
                            display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i id="chat-header-icon" class="fas fa-robot" style="color:#fff;font-size:1rem;"></i>
                </div>
                <div style="flex:1;">
                    <div style="color:#fff;font-weight:700;font-size:0.88rem;" id="chat-header-title">AI Assistant</div>
                    <div style="display:flex;align-items:center;gap:5px;margin-top:1px;">
                        <span id="admin-status-dot"
                            style="width:8px;height:8px;border-radius:50%;background:#6b7280;flex-shrink:0;
                                   transition:background 0.3s;"></span>
                        <span id="admin-status-text"
                            style="color:rgba(255,255,255,0.7);font-size:0.7rem;">Checking admin status…</span>
                    </div>
                </div>
                <!-- Mode Toggle -->
                <button id="chat-mode-btn"
                    style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);
                           color:#fff;border-radius:8px;padding:4px 9px;font-size:0.7rem;
                           cursor:pointer;transition:background 0.2s;white-space:nowrap;"
                    title="Switch between AI Bot and Live Admin Chat">
                    Talk to Admin
                </button>
                <!-- Close -->
                <button id="chat-close-btn"
                    style="background:none;border:none;color:rgba(255,255,255,0.7);
                           cursor:pointer;font-size:1rem;padding:2px 4px;">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <!-- Mode banner -->
            <div id="chat-mode-banner"
                style="display:none;padding:6px 14px;text-align:center;font-size:0.73rem;
                       background:#fef3c7;color:#92400e;border-bottom:1px solid #fde68a;">
                <i class="fas fa-headset me-1"></i>
                <span id="chat-mode-banner-text">You are now in Live Chat mode. An admin will reply shortly.</span>
            </div>

            <!-- Messages -->
            <div id="chat-messages"
                style="flex:1;overflow-y:auto;background:#f8f9fc;padding:14px;display:flex;flex-direction:column;gap:8px;">
                <div id="chat-messages-inner" style="display:flex;flex-direction:column;gap:8px;">
                    <div class="chat-bubble bot">
                        Hello! I'm your AI assistant. Ask me about bills, maintenance, or house rules 🏠<br>
                        <small style="color:#9ca3af;">Or tap <strong>Talk to Admin</strong> to chat live.</small>
                    </div>
                </div>
            </div>

            <!-- Input -->
            <div style="padding:10px 12px;background:#fff;border-top:1px solid #f1f5f9;display:flex;gap:8px;">
                <input type="text" id="chat-input"
                    style="flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:8px 12px;
                           font-size:0.84rem;outline:none;font-family:'Inter',sans-serif;"
                    placeholder="Type a message…">
                <button id="chat-send-btn"
                    style="width:38px;height:38px;border-radius:50%;
                           background:linear-gradient(135deg,#4f46e5,#7c3aed);
                           border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
                           box-shadow:0 4px 12px rgba(79,70,229,0.4);">
                    <i class="fas fa-paper-plane" style="color:#fff;font-size:0.85rem;"></i>
                </button>
            </div>
        </div>

        <style>
            .chat-bubble { max-width:78%;padding:9px 13px;border-radius:14px;font-size:0.83rem;line-height:1.5;word-break:break-word; animation: chat-pop 0.18s ease; }
            .chat-bubble.bot   { align-self:flex-start;background:#fff;color:#1f2937;border-bottom-left-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.07); }
            .chat-bubble.user  { align-self:flex-end;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border-bottom-right-radius:4px; }
            .chat-bubble.admin { align-self:flex-start;background:#fff;color:#1f2937;border-bottom-left-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.07);border-left:3px solid #c5a059; }
            .chat-time { font-size:0.65rem;color:#9ca3af;margin-top:2px; }
            .chat-time.right { text-align:right; }
            @keyframes chat-pop { from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)} }
            #chat-toggle-btn:hover { transform:scale(1.08); }
            /* ── Markdown styles inside bot bubbles ── */
            .chat-bubble.bot ul.chat-list, .chat-bubble.bot ol.chat-list { margin:4px 0 4px 16px;padding:0; }
            .chat-bubble.admin ul.chat-list, .chat-bubble.admin ol.chat-list { margin:4px 0 4px 16px;padding:0; }
            .chat-ul-item, .chat-ol-item { margin:2px 0;line-height:1.5; }
            .chat-bubble.bot strong, .chat-bubble.admin strong { font-weight:700; }
            .chat-bubble.bot em, .chat-bubble.admin em { font-style:italic; }
            .chat-code { background:rgba(0,0,0,0.07);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:0.78rem; }
        </style>
    `;

    document.body.insertAdjacentHTML('beforeend', chatHTML);

    document.getElementById('chat-toggle-btn').addEventListener('click', toggleChat);
    document.getElementById('chat-close-btn').addEventListener('click', toggleChat);
    document.getElementById('chat-send-btn').addEventListener('click', handleSend);
    document.getElementById('chat-mode-btn').addEventListener('click', toggleMode);
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
    });

    // Load tenant session info
    fetchSessionInfo();
}

// ── Fetch tenant info from session ───────────────────────────────────────────
async function fetchSessionInfo() {
    try {
        // Get session user id first
        const authRes = await fetch('/api/session-user', { credentials: 'include' });
        if (authRes.ok) {
            const authData = await authRes.json();
            chatState.tenantId = authData.id;
        }

        // Get profile for name and room number
        const res = await fetch('/api/profile/me', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!chatState.tenantId) chatState.tenantId = data.tenant_id;
        chatState.tenantName = data.full_name  || 'Tenant';
        chatState.roomNumber = data.room_number || null;
        chatState.sessionId  = `tenant-${chatState.tenantId}`;
    } catch (_) {}
}

// ── Toggle chat open/close ────────────────────────────────────────────────────
function toggleChat() {
    const widget = document.getElementById('chat-widget');
    const btn    = document.getElementById('chat-toggle-btn');
    chatState.isOpen = !chatState.isOpen;

    if (chatState.isOpen) {
        widget.classList.remove('d-none');
        widget.style.display = 'flex';
        btn.classList.add('d-none');
        // Clear unread dot
        const dot = document.getElementById('chat-unread-dot');
        if (dot) dot.style.display = 'none';
        document.getElementById('chat-input').focus();
        // If in live mode, ensure socket is connected and reload history
        if (chatState.mode === 'live') {
            // Guard: only connect if no socket exists AND no connection is in-flight
            if (!chatState.socket && !chatState.connecting) connectSocket();
            loadLiveChatHistory();
        }
    } else {
        widget.classList.add('d-none');
        btn.classList.remove('d-none');
    }
}

// ── Toggle between AI and Live mode ─────────────────────────────────────────
async function toggleMode() {
    const inner = document.getElementById('chat-messages-inner');
    if (chatState.mode === 'ai') {
        // Switch to Live Chat
        chatState.mode = 'live';
        updateModeUI();
        // Clear current AI messages before loading live history
        if (inner) inner.innerHTML = '';
        // Guard: only connect if no socket exists AND no connection is in-flight
        if (!chatState.socket && !chatState.connecting) connectSocket();
        // Load history from DB
        await loadLiveChatHistory();
    } else {
        // Switch back to AI
        chatState.mode = 'ai';
        // Restore the AI welcome bubble
        if (inner) inner.innerHTML = `
            <div class="chat-bubble bot">
                Hello! I'm your AI assistant. Ask me about bills, maintenance, or house rules 🏠<br>
                <small style="color:#9ca3af;">Or tap <strong>Talk to Admin</strong> to chat live.</small>
            </div>`;
        updateModeUI();
        if (chatState.socket) {
            chatState.socket.disconnect();
            chatState.socket     = null;
            chatState.connecting = false; // reset guard so next Live entry can reconnect
        }
    }
}

function updateModeUI() {
    const isLive   = chatState.mode === 'live';
    const title    = document.getElementById('chat-header-title');
    const icon     = document.getElementById('chat-header-icon');
    const modeBtn  = document.getElementById('chat-mode-btn');
    const banner   = document.getElementById('chat-mode-banner');
    const header   = document.getElementById('chat-header');
    const input    = document.getElementById('chat-input');

    if (isLive) {
        if (title)   title.textContent   = 'Live Admin Chat';
        if (icon)    icon.className      = 'fas fa-headset';
        if (modeBtn) modeBtn.textContent = 'Switch to AI';
        if (banner)  banner.style.display = 'block';
        if (header)  header.style.background = 'linear-gradient(135deg,#c5a059,#9a7d3a)';
        if (input)   input.placeholder   = 'Message admin…';
    } else {
        if (title)   title.textContent   = 'AI Assistant';
        if (icon)    icon.className      = 'fas fa-robot';
        if (modeBtn) modeBtn.textContent = 'Talk to Admin';
        if (banner)  banner.style.display = 'none';
        if (header)  header.style.background = 'linear-gradient(135deg,#4f46e5,#7c3aed)';
        if (input)   input.placeholder   = 'Type a message…';
    }
}

// ── Connect Socket.io ────────────────────────────────────────────────────────
function connectSocket() {
    // Prevent overlapping connection attempts (rapid mode toggles, retry loops)
    if (chatState.connecting || chatState.socket) return;
    chatState.connecting = true;

    if (!chatState.tenantId) {
        // tenantId not yet loaded — retry after session fetch completes
        setTimeout(() => {
            chatState.connecting = false; // release guard so the retry can proceed
            connectSocket();
        }, 800);
        return;
    }

    chatState.socket = io();
    chatState.connecting = false; // socket object exists; guard no longer needed

    chatState.socket.emit('tenant:join', {
        tenantId:   chatState.tenantId,
        tenantName: chatState.tenantName,
        roomNumber: chatState.roomNumber
    });

    // Admin status update
    chatState.socket.on('admin:status', ({ online }) => {
        chatState.adminOnline = online;
        updateAdminStatusUI(online);
    });

    // Incoming admin message
    chatState.socket.on('tenant:new-message', ({ message, timestamp }) => {
        appendBubble(message, 'admin', timestamp);
        playTenantNotification();
        // Show unread dot if chat is closed
        if (!chatState.isOpen) {
            const dot = document.getElementById('chat-unread-dot');
            if (dot) dot.style.display = 'block';
        }
    });
}

function updateAdminStatusUI(online) {
    const dot  = document.getElementById('admin-status-dot');
    const text = document.getElementById('admin-status-text');
    const banner = document.getElementById('chat-mode-banner-text');
    if (dot)  dot.style.background = online ? '#22c55e' : '#6b7280';
    if (text) text.textContent = online ? 'Admin is online' : 'Admin is offline';
    if (banner) {
        banner.innerHTML = online
            ? '<i class="fas fa-circle" style="color:#22c55e;font-size:0.6rem;"></i> Admin is online — messages delivered instantly'
            : '<i class="fas fa-clock"></i> Admin is offline — messages saved, will reply soon';
    }
}

// ── Load live chat history from DB ────────────────────────────────────────────
async function loadLiveChatHistory() {
    try {
        const res = await fetch('/api/live-chat/history', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const inner = document.getElementById('chat-messages-inner');
        if (!inner) return;
        // Always clear and re-render the full history to avoid duplicates
        inner.innerHTML = '';
        if (data.messages && data.messages.length > 0) {
            data.messages.forEach(m => appendBubble(m.message, m.sender === 'admin' ? 'admin' : 'user', m.created_at));
        } else {
            inner.innerHTML = `<div class="chat-bubble bot">No messages yet. Type your first message to start!</div>`;
        }
    } catch (_) {}
}

// ── Handle send ───────────────────────────────────────────────────────────────
async function handleSend() {
    const input   = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';

    if (chatState.mode === 'live') {
        sendLiveMessage(message);
    } else {
        sendAIMessage(message);
    }
}

// ── Send via Socket.io (Live Chat mode) ──────────────────────────────────────
function sendLiveMessage(message) {
    appendBubble(message, 'user', new Date().toISOString());

    if (!chatState.socket || !chatState.tenantId) {
        appendBubble('Connection error. Please refresh and try again.', 'bot');
        return;
    }
    chatState.socket.emit('tenant:message', {
        tenantId:  chatState.tenantId,
        message,
        sessionId: chatState.sessionId
    });

    if (!chatState.adminOnline) {
        setTimeout(() => appendBubble("Admin is currently offline. Your message has been saved — we'll reply soon! ✉️", 'bot'), 300);
    }
}

// ── Send via Gemini AI (AI mode) ─────────────────────────────────────────────
async function sendAIMessage(message) {
    appendBubble(message, 'user');
    const typingId = showTyping();

    try {
        const res = await fetch('/api/chat/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history: chatState.history.slice(-20) }),
            credentials: 'include'
        });
        const data = await res.json();
        removeTyping(typingId);
        if (res.ok) {
            appendBubble(data.reply, 'bot');
            chatState.history.push({ role: 'user', text: message });
            chatState.history.push({ role: 'bot',  text: data.reply });
        } else {
            appendBubble("Sorry, I'm having trouble right now.", 'bot');
        }
    } catch (err) {
        removeTyping(typingId);
        appendBubble('Unable to reach the AI assistant.', 'bot');
    }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function appendBubble(text, sender, timestamp) {
    const inner = document.getElementById('chat-messages-inner');
    if (!inner) return;
    const cssClass = sender === 'user' ? 'user' : sender === 'admin' ? 'admin' : 'bot';
    const timeHTML = timestamp
        ? `<div class="chat-time ${sender === 'user' ? 'right' : ''}">${formatChatTime(timestamp)}</div>`
        : '';
    // Bot and admin messages render markdown; user messages are plain-escaped (XSS safe)
    const contentHTML = sender === 'user'
        ? escapeHtml(text)
        : renderMarkdown(text);
    inner.insertAdjacentHTML('beforeend', `
        <div style="display:flex;flex-direction:column;align-items:${sender === 'user' ? 'flex-end' : 'flex-start'};">
            <div class="chat-bubble ${cssClass}">${contentHTML}</div>
            ${timeHTML}
        </div>`);
    const msgs = document.getElementById('chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

// ── Safe Markdown Renderer (for bot messages only) ───────────────────────────
// Converts Gemini's markdown output to safe HTML.
// ONLY used for bot/admin bubbles — user messages always use escapeHtml.
function renderMarkdown(text) {
    if (!text) return '';

    let html = text
        // Escape raw HTML first (safety)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // ── Block: Numbered lists  (must come before bold/italic) ──────────────
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li class="chat-ol-item">$2</li>');
    html = html.replace(/(<li class="chat-ol-item">.*<\/li>\n?)+/g,
        match => `<ol class="chat-list">${match}</ol>`);

    // ── Block: Bullet lists ────────────────────────────────────────────────
    html = html.replace(/^[\-\*] (.+)$/gm, '<li class="chat-ul-item">$1</li>');
    html = html.replace(/(<li class="chat-ul-item">.*<\/li>\n?)+/g,
        match => `<ul class="chat-list">${match}</ul>`);

    // ── Inline: Bold (**text** or __text__) ───────────────────────────────
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // ── Inline: Italic (*text* or _text_) ────────────────────────────────
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    // ── Inline: Code (`code`) ────────────────────────────────────────────
    html = html.replace(/`([^`]+)`/g, '<code class="chat-code">$1</code>');

    // ── Line breaks (\n → <br>) ───────────────────────────────────────────
    html = html.replace(/\n/g, '<br>');

    return html;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showTyping() {
    const id   = 'typing-' + Date.now();
    const inner = document.getElementById('chat-messages-inner');
    if (inner) {
        inner.insertAdjacentHTML('beforeend', `
            <div id="${id}" class="chat-bubble bot">
                <i class="fas fa-circle-notch fa-spin me-1"></i><small>Typing…</small>
            </div>`);
        const msgs = document.getElementById('chat-messages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }
    return id;
}

function removeTyping(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initChatUI);
