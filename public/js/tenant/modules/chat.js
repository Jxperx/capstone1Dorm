// --- Chatbot Logic ---

const chatState = {
    isOpen: false,
    history: []
};

// 1. Create UI Elements
function initChatUI() {
    // Check if chat container already exists
    if (document.getElementById('chat-widget')) return;

    const chatHTML = `
        <!-- Chat Button -->
        <button id="chat-toggle-btn" class="btn btn-primary rounded-circle shadow-lg d-flex align-items-center justify-content-center" 
            style="position: fixed; bottom: 30px; right: 30px; width: 60px; height: 60px; z-index: 1000;">
            <i class="fas fa-comment-dots fa-lg"></i>
        </button>

        <!-- Chat Window -->
        <div id="chat-widget" class="card shadow-lg d-none" 
            style="position: fixed; bottom: 100px; right: 30px; width: 350px; height: 500px; z-index: 1000; display: flex; flex-direction: column;">
            
            <!-- Header -->
            <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center">
                    <i class="fas fa-robot me-2"></i>
                    <strong>Boarding House Assistant</strong>
                </div>
                <button id="chat-close-btn" class="btn btn-sm btn-link text-white text-decoration-none">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <!-- Messages Area -->
            <div id="chat-messages" class="card-body overflow-auto flex-grow-1" style="background-color: #f8f9fa;">
                <div class="d-flex flex-column gap-2">
                    <!-- Welcome Message -->
                    <div class="align-self-start bg-white p-2 rounded shadow-sm border" style="max-width: 80%;">
                        Hello! I'm your AI assistant. Ask me about utility bills, maintenance, or house rules! 🏠
                    </div>
                </div>
            </div>

            <!-- Input Area -->
            <div class="card-footer bg-white border-top p-2">
                <div class="input-group">
                    <input type="text" id="chat-input" class="form-control border-0" placeholder="Type a message..." aria-label="Type a message...">
                    <button class="btn btn-primary" id="chat-send-btn">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </div>
    `;

    // Append to body
    document.body.insertAdjacentHTML('beforeend', chatHTML);

    // Event Listeners
    document.getElementById('chat-toggle-btn').addEventListener('click', toggleChat);
    document.getElementById('chat-close-btn').addEventListener('click', toggleChat);
    document.getElementById('chat-send-btn').addEventListener('click', sendMessage);
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
}

// 2. Toggle Chat Window
function toggleChat() {
    const widget = document.getElementById('chat-widget');
    const btn = document.getElementById('chat-toggle-btn');
    
    chatState.isOpen = !chatState.isOpen;
    
    if (chatState.isOpen) {
        widget.classList.remove('d-none');
        btn.classList.add('d-none');
        document.getElementById('chat-input').focus();
    } else {
        widget.classList.add('d-none');
        btn.classList.remove('d-none');
    }
}

// 3. Send Message
async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    // Clear input
    input.value = '';

    // Add User Message to UI
    appendMessage(message, 'user');

    // Show Typing Indicator
    const typingId = showTypingIndicator();

    try {
        const res = await fetch('/api/chat/chat', { // Check route path in server.js
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: message,
                history: chatState.history.slice(-5) // Send last 5 messages for context
            })
        });

        const data = await res.json();
        
        // Remove Typing Indicator
        removeTypingIndicator(typingId);

        if (res.ok) {
            appendMessage(data.reply, 'bot');
            // Update history
            chatState.history.push({ role: 'user', text: message });
            chatState.history.push({ role: 'bot', text: data.reply });
        } else {
            appendMessage("Sorry, I'm having trouble connecting right now.", 'bot');
        }
    } catch (err) {
        console.error(err);
        removeTypingIndicator(typingId);
        appendMessage("Error: Unable to reach the assistant.", 'bot');
    }
}

// 4. Helper Functions
function appendMessage(text, sender) {
    const messagesDiv = document.getElementById('chat-messages');
    const container = messagesDiv.firstElementChild; // .d-flex .flex-column
    
    const isUser = sender === 'user';
    const alignClass = isUser ? 'align-self-end bg-primary text-white' : 'align-self-start bg-white border text-dark';
    
    const msgHTML = `
        <div class="${alignClass} p-2 rounded shadow-sm" style="max-width: 80%; word-wrap: break-word;">
            ${text}
        </div>
    `;
    
    container.insertAdjacentHTML('beforeend', msgHTML);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showTypingIndicator() {
    const messagesDiv = document.getElementById('chat-messages').firstElementChild;
    const id = 'typing-' + Date.now();
    
    const html = `
        <div id="${id}" class="align-self-start bg-white border text-secondary p-2 rounded shadow-sm" style="max-width: 80%;">
            <small><i class="fas fa-circle-notch fa-spin me-1"></i> Typing...</small>
        </div>
    `;
    
    messagesDiv.insertAdjacentHTML('beforeend', html);
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    return id;
}

function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initChatUI);
