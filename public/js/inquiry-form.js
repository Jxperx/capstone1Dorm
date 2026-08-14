/**
 * public/js/inquiry-form.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles the landing page inquiry form submission:
 *   - Captures FingerprintJS device_id
 *   - Validates fields client-side (including ID uploads)
 *   - POSTs FormData (multipart) to /api/inquiries/submit
 *   - Shows success / error toast
 */

(function () {
    'use strict';

    let deviceId = '';

    // ── Load FingerprintJS and capture device_id ──────────────────────────────
    async function initFingerprint() {
        try {
            if (typeof FingerprintJS !== 'undefined') {
                const fp     = await FingerprintJS.load();
                const result = await fp.get();
                deviceId = result.visitorId;
            }
        } catch (e) {
            console.warn('[InquiryForm] FingerprintJS not available:', e.message);
        }
    }

    // ── Toast notification ────────────────────────────────────────────────────
    function showToast(message, type = 'success') {
        // Remove existing toast if any
        document.getElementById('inquiry-toast')?.remove();

        const bgColor = type === 'success' ? 'linear-gradient(135deg,#1a7a4a,#27ae60)'
                                           : 'linear-gradient(135deg,#8b1a1a,#e74c3c)';
        const icon    = type === 'success' ? '✓' : '✕';

        const toast = document.createElement('div');
        toast.id    = 'inquiry-toast';
        toast.style.cssText = `
            position: fixed; bottom: 32px; right: 32px; z-index: 99999;
            background: ${bgColor}; color: #fff;
            padding: 16px 24px; border-radius: 10px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.35);
            font-family: 'Inter', sans-serif; font-size: 0.92rem;
            display: flex; align-items: center; gap: 10px;
            max-width: 380px; line-height: 1.4;
            animation: toastIn 0.35s ease;
        `;
        toast.innerHTML = `
            <span style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.25);
                         display:flex;align-items:center;justify-content:center;
                         font-weight:bold;flex-shrink:0;">${icon}</span>
            <span>${message}</span>
        `;

        // Inject keyframe animation if not already present
        if (!document.getElementById('inquiry-toast-style')) {
            const style = document.createElement('style');
            style.id = 'inquiry-toast-style';
            style.textContent = `
                @keyframes toastIn  { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
                @keyframes toastOut { from { opacity:1; } to { opacity:0; transform:translateY(10px); } }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toastOut 0.35s ease forwards';
            setTimeout(() => toast.remove(), 400);
        }, 5000);
    }

    // ── Set button state ──────────────────────────────────────────────────────
    function setSubmitting(btn, isSubmitting) {
        const originalText = btn.dataset.originalText || btn.innerHTML;
        btn.dataset.originalText = originalText;

        if (isSubmitting) {
            btn.disabled = true;
            btn.innerHTML = `
                <span style="display:inline-flex;align-items:center;gap:8px;">
                    <svg width="18" height="18" viewBox="0 0 50 50" style="animation:spin 0.8s linear infinite">
                        <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5"
                                stroke-dasharray="80 20" stroke-linecap="round"/>
                    </svg>
                    Submitting…
                </span>`;
            if (!document.getElementById('spin-style')) {
                const s = document.createElement('style');
                s.id = 'spin-style';
                s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
                document.head.appendChild(s);
            }
        } else {
            btn.disabled  = false;
            btn.innerHTML = originalText;
        }
    }

    // ── Form submit handler ───────────────────────────────────────────────────
    async function handleSubmit(e) {
        e.preventDefault();

        const form      = document.getElementById('inquiryForm');
        const submitBtn = document.getElementById('inquirySubmitBtn');

        if (!form || !submitBtn) return;

        // Basic client-side validation
        const firstName   = (form.first_name?.value  || '').trim();
        const lastName    = (form.last_name?.value   || '').trim();
        const email       = (form.email?.value       || '').trim();
        const phone       = (form.phone?.value       || '').trim();
        const honeypot    = (form.hp_field?.value    || '').trim();

        if (!firstName || !lastName) {
            return showToast('Please enter your first and last name.', 'error');
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            return showToast('Please enter a valid email address.', 'error');
        }
        if (!/^\+?[\d\s\-().]{7,20}$/.test(phone)) {
            return showToast('Please enter a valid phone number.', 'error');
        }

        // Validate ID uploads — at least one required
        const schoolFile = document.getElementById('schoolIdInput')?.files?.[0];
        const govtFile   = document.getElementById('govtIdInput')?.files?.[0];
        if (!schoolFile && !govtFile) return showToast('Please upload at least one ID (School ID or Government ID).', 'error');

        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        const maxSize = 5 * 1024 * 1024;
        for (const f of [schoolFile, govtFile].filter(Boolean)) {
            if (!allowedTypes.includes(f.type)) return showToast('ID photos must be JPG or PNG format.', 'error');
            if (f.size > maxSize) return showToast('Each ID photo must be under 5MB.', 'error');
        }

        setSubmitting(submitBtn, true);

        try {
            // Build FormData for multipart upload
            const fd = new FormData();
            fd.append('first_name',     firstName);
            fd.append('last_name',      lastName);
            fd.append('email',          email);
            fd.append('phone',          phone);
            fd.append('guardian_phone', (form.guardian_phone?.value || '').trim());
            fd.append('preferred_unit', (form.preferred_unit?.value || '').trim());
            fd.append('message',        (form.message?.value || '').trim());
            fd.append('device_id',      deviceId);
            fd.append('hp_field',       honeypot);
            if (schoolFile) fd.append('school_id', schoolFile);
            if (govtFile)   fd.append('govt_id',   govtFile);

            const roomQuizJson  = (form.room_quiz?.value  || '').trim();
            const roomQuizScore = (form.quiz_score?.value || '').trim();
            if (roomQuizJson)  fd.append('room_quiz',  roomQuizJson);
            if (roomQuizScore) fd.append('quiz_score', roomQuizScore);

            const res = await fetch('/api/inquiries/submit', {
                method: 'POST',
                body: fd,
                credentials: 'include'
            });

            const data = await res.json();

            if (res.status === 429) {
                showToast('Too many submissions. Please wait 15 minutes.', 'error');
            } else if (data.success) {
                showToast('✓ Thank you! Your inquiry has been received. We\'ll contact you within 24 hours.', 'success');
                form.reset();
                // Reset file previews
                ['school', 'govt'].forEach(type => {
                    if (typeof removeIdUpload === 'function') removeIdUpload(type);
                });
            } else if (data.errors && data.errors.length > 0) {
                showToast(data.errors[0], 'error');
            } else {
                showToast(data.message || 'An error occurred. Please try again.', 'error');
            }
        } catch (err) {
            console.error('[InquiryForm] Submit error:', err);
            showToast('Network error. Please check your connection and try again.', 'error');
        } finally {
            setSubmitting(submitBtn, false);
        }
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        initFingerprint();

        const btn = document.getElementById('inquirySubmitBtn');
        if (btn) {
            btn.addEventListener('click', handleSubmit);
        }

        // Also support direct form submit
        const form = document.getElementById('inquiryForm');
        if (form) {
            form.addEventListener('submit', handleSubmit);
        }
    });
})();
