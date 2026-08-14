// =============================================================
// Admin Live Chat Module — Real-time Socket.io Chat
// =============================================================

const LiveChatAdmin = (() => {
    let socket        = null;
    let sessions      = {};       // { sessionId: { tenantId, tenantName, roomNumber, messages, unread, lastMessage, lastTime } }
    let activeSession = null;     // currently viewed sessionId
    let isInitialized = false;
    let totalUnread   = 0;
    let adminStatus   = 'available'; // 'available' | 'busy'

    // ── Notification Sound (Web Audio API) ──────────────────────────────────
    function playNotification() {
        try {
            const ctx  = new (window.AudioContext || window.webkitAudioContext)();
            // Two-tone chime: high then slightly lower
            [880, 660].forEach((freq, i) => {
                const osc  = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type            = 'sine';
                osc.frequency.value = freq;
                const start = ctx.currentTime + i * 0.18;
                gain.gain.setValueAtTime(0.25, start);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
                osc.start(start);
                osc.stop(start + 0.45);
            });
        } catch (_) { /* Browser may block autoplay — silent fail */ }
    }

    // ── Format timestamp ─────────────────────────────────────────────────────
    function formatTime(isoStr) {
        const d = new Date(isoStr);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    function formatDate(isoStr) {
        const d = new Date(isoStr);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) return formatTime(isoStr);
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // ── Update sidebar badge ─────────────────────────────────────────────────
    function updateSidebarBadge() {
        totalUnread = Object.values(sessions).reduce((sum, s) => sum + (s.unread || 0), 0);
        const badge = document.getElementById('lc-sidebar-badge');
        if (!badge) return;
        if (totalUnread > 0) {
            badge.textContent = totalUnread;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    // ── Render session list ──────────────────────────────────────────────────
    function renderSessionList() {
        const list = document.getElementById('lc-session-list');
        if (!list) return;
        const keys = Object.keys(sessions);
        if (keys.length === 0) {
            list.innerHTML = `<div class="lc-empty-sessions"><i class="fas fa-comments"></i>No active conversations yet</div>`;
            return;
        }
        // Sort by most recent
        keys.sort((a, b) => new Date(sessions[b].lastTime || 0) - new Date(sessions[a].lastTime || 0));
        list.innerHTML = keys.map(sid => {
            const s = sessions[sid];
            const initials = (s.tenantName || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
            const isActive = sid === activeSession;
            return `
            <div class="lc-session-item${isActive ? ' active' : ''}" onclick="LiveChatAdmin.selectSession('${sid}')">
                <div class="lc-session-avatar">${initials}</div>
                <div class="lc-session-info">
                    <div class="lc-session-name">${s.tenantName || 'Tenant'}</div>
                    <div class="lc-session-preview">${s.lastMessage ? s.lastMessage.substring(0, 35) + (s.lastMessage.length > 35 ? '…' : '') : 'No messages yet'}</div>
                </div>
                <div class="lc-session-meta">
                    <div class="lc-session-time">${s.lastTime ? formatDate(s.lastTime) : ''}</div>
                    ${(s.unread > 0) ? `<div class="lc-unread-badge">${s.unread}</div>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    // ── Render messages in active session ────────────────────────────────────
    function renderMessages(sessionId) {
        const panel = document.getElementById('lc-messages-area');
        if (!panel) return;
        const s = sessions[sessionId];
        if (!s || s.messages.length === 0) {
            panel.innerHTML = `<div class="lc-empty-chat"><i class="fas fa-comment-slash"></i><p>No messages yet</p></div>`;
            return;
        }
        panel.innerHTML = s.messages.map(m => `
            <div class="lc-msg ${m.sender}">
                <div class="lc-msg-bubble">${escapeHtml(m.message)}</div>
                <div class="lc-msg-time">${formatTime(m.created_at || m.timestamp)}</div>
            </div>`
        ).join('');
        panel.scrollTop = panel.scrollHeight;
    }

    function escapeHtml(str) {
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function updateChatHeader(sessionId) {
        const headerEl    = document.getElementById('lc-chat-header');
        const headerName  = document.getElementById('lc-header-name');
        const headerRoom  = document.getElementById('lc-header-room');
        const headerAvatar= document.getElementById('lc-header-avatar');
        const inputArea   = document.getElementById('lc-input-area');
        const noSelection = document.getElementById('lc-no-selection');

        if (!sessionId) {
            if (headerEl)    headerEl.style.display    = 'none';
            if (inputArea)   inputArea.style.display   = 'none';
            if (noSelection) noSelection.style.display = 'flex';
            return;
        }
        const s = sessions[sessionId];
        if (!s) return;
        const initials = (s.tenantName || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        if (headerEl)     headerEl.style.display    = 'flex';
        if (headerName)   headerName.textContent    = s.tenantName || 'Tenant';
        if (headerRoom)   headerRoom.textContent    = s.roomNumber ? `Room ${s.roomNumber}` : 'No room assigned';
        if (headerAvatar) headerAvatar.textContent  = initials;
        if (inputArea)    inputArea.style.display   = 'flex';
        if (noSelection)  noSelection.style.display = 'none';
    }

    // ── Load sessions from DB (REST) ───────────────────────────────────────────────────
    async function loadSessions() {
        try {
            const res = await fetch('/api/admin/live-chat/sessions', { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            (data.sessions || []).forEach(s => {
                const sid = s.session_id;
                if (!sessions[sid]) {
                    // New session — create entry
                    sessions[sid] = {
                        tenantId:    s.tenant_id,
                        tenantName:  s.tenant_name,
                        roomNumber:  s.room_number,
                        messages:    [],
                        unread:      Number(s.unread_count) || 0,
                        lastMessage: s.last_message,
                        lastTime:    s.last_message_time
                    };
                } else {
                    // Existing session — refresh metadata from DB
                    sessions[sid].tenantName  = s.tenant_name  || sessions[sid].tenantName;
                    sessions[sid].roomNumber  = s.room_number  || sessions[sid].roomNumber;
                    sessions[sid].lastMessage = s.last_message || sessions[sid].lastMessage;
                    sessions[sid].lastTime    = s.last_message_time || sessions[sid].lastTime;
                    // Only update unread if not currently viewing this session
                    if (sid !== activeSession) {
                        sessions[sid].unread = Number(s.unread_count) || 0;
                    }
                }
            });
            renderSessionList();
            updateSidebarBadge();
        } catch (e) {
            console.error('[LiveChat] loadSessions error:', e.message);
        }
    }

    // ── Load messages for a session (REST) ───────────────────────────────────
    async function loadMessages(sessionId) {
        try {
            const res = await fetch(`/api/admin/live-chat/messages/${encodeURIComponent(sessionId)}`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            if (sessions[sessionId]) {
                sessions[sessionId].messages = data.messages || [];
            }
        } catch (e) {
            console.error('[LiveChat] loadMessages error:', e.message);
        }
    }

    // ── Mark session as read (REST) ──────────────────────────────────────────
    async function markRead(sessionId) {
        try {
            await fetch(`/api/admin/live-chat/read/${encodeURIComponent(sessionId)}`, {
                method: 'PATCH', credentials: 'include'
            });
        } catch (_) {}
    }

    // ── Select a session ─────────────────────────────────────────────────────
    async function selectSession(sessionId) {
        activeSession = sessionId;
        if (sessions[sessionId]) sessions[sessionId].unread = 0;
        updateSidebarBadge();
        renderSessionList();
        updateChatHeader(sessionId);
        await loadMessages(sessionId);
        renderMessages(sessionId);
        markRead(sessionId);
        // Focus reply input
        const input = document.getElementById('lc-reply-input');
        if (input) input.focus();
    }

    // ── Send admin reply ──────────────────────────────────────────────────────
    function sendReply() {
        if (!socket || !activeSession) return;
        const input = document.getElementById('lc-reply-input');
        if (!input) return;
        const message = input.value.trim();
        if (!message) return;
        const s = sessions[activeSession];
        if (!s) return;

        input.value = '';
        input.style.height = 'auto';

        const msg = { sender: 'admin', message, timestamp: new Date().toISOString(), created_at: new Date().toISOString() };
        s.messages.push(msg);
        s.lastMessage = message;
        s.lastTime    = msg.timestamp;
        renderMessages(activeSession);
        renderSessionList();

        socket.emit('admin:message', {
            tenantId:  s.tenantId,
            message,
            sessionId: activeSession
        });
    }

    // ── Toggle admin status ──────────────────────────────────────────────────
    function toggleStatus() {
        if (!socket) return;
        adminStatus = adminStatus === 'available' ? 'busy' : 'available';
        socket.emit('admin:set-status', { online: adminStatus === 'available' });
        updateStatusUI();
    }

    function updateStatusUI() {
        const dot   = document.getElementById('lc-status-dot');
        const label = document.getElementById('lc-status-label');
        if (!dot || !label) return;
        const isAvailable = adminStatus === 'available';
        dot.className   = `lc-status-dot ${isAvailable ? 'online' : 'busy'}`;
        label.textContent = isAvailable ? 'Available — click to set Busy' : 'Busy — click to set Available';
    }

    // ── Init Socket.io connection ────────────────────────────────────────────
    function init() {
        if (isInitialized) return;
        isInitialized = true;

        socket = io();
        socket.emit('admin:join');

        // New message from tenant
        socket.on('admin:new-message', (data) => {
            const sid = data.sessionId;
            if (!sessions[sid]) {
                sessions[sid] = {
                    tenantId:    data.tenantId,
                    tenantName:  data.tenantName,
                    roomNumber:  data.roomNumber,
                    messages:    [],
                    unread:      0,
                    lastMessage: data.message,
                    lastTime:    data.timestamp
                };
            }
            sessions[sid].messages.push({
                sender: 'tenant', message: data.message,
                timestamp: data.timestamp, created_at: data.timestamp
            });
            sessions[sid].lastMessage = data.message;
            sessions[sid].lastTime    = data.timestamp;

            if (activeSession !== sid) {
                sessions[sid].unread = (sessions[sid].unread || 0) + 1;
                playNotification();
            }

            renderSessionList();
            if (activeSession === sid) renderMessages(sid);
            updateSidebarBadge();
        });

        // Tenant connected notification (new session)
        socket.on('tenant:connected', (data) => {
            const sid = data.sessionId;
            if (!sessions[sid]) {
                sessions[sid] = {
                    tenantId:   data.tenantId,
                    tenantName: data.tenantName,
                    roomNumber: data.roomNumber,
                    messages:   [],
                    unread:     0,
                    lastMessage: null,
                    lastTime:   new Date().toISOString()
                };
                renderSessionList();
            }
        });

        updateStatusUI();
        loadSessions();

        // Wire up reply input events
        const input = document.getElementById('lc-reply-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
            });
            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            });
        }

        const sendBtn = document.getElementById('lc-send-btn');
        if (sendBtn) sendBtn.addEventListener('click', sendReply);

        const statusBtn = document.getElementById('lc-status-toggle');
        if (statusBtn) statusBtn.addEventListener('click', toggleStatus);
    }

    // Public API
    return { init, selectSession, toggleStatus, sendReply };
})();
