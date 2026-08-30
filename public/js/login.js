/**
 * public/js/login.js
 * Handles: Login form, Login OTP, Forgot Password (3-step flow),
 *          password strength bar, show/hide password, resend countdown.
 */

// ── State ────────────────────────────────────────────────────────────────────
let resetEmail = sessionStorage.getItem('resetEmail') || '';        // Email used in forgot-password flow
let resendTimerInterval = null;

// ── Panel Manager ─────────────────────────────────────────────────────────────
const PANELS = ['login', 'otp', 'forgot', 'reset-otp', 'new-password'];

const OVERLAY_TEXT = {
    'login':        { title: 'Welcome Back',       desc: 'Experience premium student living at its finest.' },
    'otp':          { title: 'Almost There',        desc: 'Enter the verification code sent to your inbox.' },
    'forgot':       { title: 'Forgot Password?',    desc: 'We\'ll send a secure reset code to your email.' },
    'reset-otp':    { title: 'Check Your Email',    desc: 'Enter the 6-digit code we just sent you.' },
    'new-password': { title: 'Almost Done',         desc: 'Set a strong new password for your account.' },
};

function showPanel(name) {
    PANELS.forEach(p => {
        const el = document.getElementById('panel-' + p);
        if (el) {
            if (p === name) {
                el.classList.remove('d-none');
                // Re-trigger animation
                el.classList.remove('auth-panel');
                void el.offsetWidth;
                el.classList.add('auth-panel');
            } else {
                el.classList.add('d-none');
            }
        }
    });

    // Update overlay text
    const txt = OVERLAY_TEXT[name] || OVERLAY_TEXT['login'];
    const titleEl = document.getElementById('authOverlayTitle');
    const descEl  = document.getElementById('authOverlayDesc');
    if (titleEl) titleEl.textContent = txt.title;
    if (descEl)  descEl.textContent  = txt.desc;
}

// ── Utility ───────────────────────────────────────────────────────────────────
function setButtonLoading(btn, loading, originalText) {
    if (loading) {
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Please wait…';
        btn.disabled = true;
    } else {
        btn.innerHTML = originalText || btn.dataset.originalText || btn.innerHTML;
        btn.disabled = false;
    }
}

function showError(msg) {
    // Use alert for simplicity — consistent with existing code
    alert(msg);
}

// ── Password Strength ─────────────────────────────────────────────────────────
function getPasswordStrength(pwd) {
    let score = 0;
    if (pwd.length >= 8)  score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd))   score++;
    if (/[0-9]/.test(pwd))   score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    if (score <= 1) return { label: 'Weak',   pct: 20,  color: '#e74c3c' };
    if (score === 2) return { label: 'Fair',   pct: 40,  color: '#e67e22' };
    if (score === 3) return { label: 'Good',   pct: 65,  color: '#f39c12' };
    if (score === 4) return { label: 'Strong', pct: 85,  color: '#27ae60' };
    return               { label: 'Very Strong', pct: 100, color: '#1a8a4a' };
}

const newPwdInput = document.getElementById('new-password-input');
if (newPwdInput) {
    newPwdInput.addEventListener('input', () => {
        const val = newPwdInput.value;
        const fill  = document.getElementById('pwd-strength-fill');
        const label = document.getElementById('pwd-strength-label');
        if (!fill || !label) return;
        if (!val) {
            fill.style.width = '0%';
            label.textContent = '—';
            label.style.color = '#aaa';
            return;
        }
        const s = getPasswordStrength(val);
        fill.style.width      = s.pct + '%';
        fill.style.background = s.color;
        label.textContent     = s.label;
        label.style.color     = s.color;
    });
}

// ── Show/Hide Password Toggle ─────────────────────────────────────────────────
function togglePwd(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    const icon = btn.querySelector('i');
    if (icon) icon.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
}

// ── Resend Countdown ──────────────────────────────────────────────────────────
function startResendCountdown(seconds = 60) {
    clearInterval(resendTimerInterval);
    const timerEl    = document.getElementById('resend-timer');
    const btnEl      = document.getElementById('resend-btn');
    const countEl    = document.getElementById('resend-countdown');
    if (!timerEl || !btnEl || !countEl) return;

    timerEl.classList.remove('d-none');
    btnEl.classList.add('d-none');

    let remaining = seconds;
    countEl.textContent = remaining;

    resendTimerInterval = setInterval(() => {
        remaining--;
        countEl.textContent = remaining;
        if (remaining <= 0) {
            clearInterval(resendTimerInterval);
            timerEl.classList.add('d-none');
            btnEl.classList.remove('d-none');
        }
    }, 1000);
}

// ── Forgot Password: Resend Code ──────────────────────────────────────────────
async function handleResendCode() {
    if (!resetEmail) return;
    const btn = document.getElementById('resend-btn');
    if (btn) btn.disabled = true;

    try {
        await fetch('/api/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: resetEmail }),
            credentials: 'include'
        });
        startResendCountdown(60);
    } catch (_) {
        if (btn) btn.disabled = false;
    }
}

// ── Login Form ────────────────────────────────────────────────────────────────
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email    = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const btn      = document.getElementById('login-submit-btn');

        setButtonLoading(btn, true);
        try {
            const res    = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
                credentials: 'include'
            });
            const result = await res.json();

            if (res.ok) {
                if (result.otpRequired) {
                    showPanel('otp');
                } else {
                    window.location.href = result.role === 'admin' ? '/admin' : '/tenant';
                }
            } else {
                const detail = result.details ? `\n\nDetails: ${result.details}` : '';
                showError((result.error || result.message || 'Login failed.') + detail);
            }
        } catch (err) {
            console.error('[Login Error]', err);
            showError(err.message || 'An error occurred during login.');
        } finally {
            setButtonLoading(btn, false);
        }
    });
}

// ── Login OTP Form ────────────────────────────────────────────────────────────
const otpForm = document.getElementById('otp-form');
if (otpForm) {
    otpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const otp = otpForm.querySelector('input[name="otp"]').value;
        const btn = otpForm.querySelector('button[type="submit"]');

        setButtonLoading(btn, true);
        try {
            const res    = await fetch('/api/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ otp }),
                credentials: 'include'
            });
            const result = await res.json();

            if (res.ok) {
                window.location.href = '/tenant';
            } else {
                showError(result.error || 'Verification failed.');
            }
        } catch (err) {
            showError('An error occurred during verification.');
        } finally {
            setButtonLoading(btn, false);
        }
    });

    // Back to login from login-OTP panel
    const backBtn = document.getElementById('back-to-login');
    if (backBtn) backBtn.addEventListener('click', () => showPanel('login'));
}

// ── Forgot Password Link ──────────────────────────────────────────────────────
const forgotLink = document.getElementById('forgotPasswordLink');
if (forgotLink) {
    forgotLink.addEventListener('click', (e) => {
        e.preventDefault();
        showPanel('forgot');
    });
}

// ── Forgot: Step 1 — Send OTP ─────────────────────────────────────────────────
const forgotForm = document.getElementById('forgot-form');
if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById('forgot-email');
        const btn        = document.getElementById('forgot-submit-btn');
        const email      = emailInput.value.trim();

        setButtonLoading(btn, true);
        try {
            const res    = await fetch('/api/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
                credentials: 'include'
            });
            const result = await res.json();

            if (res.ok && result.success) {
                resetEmail = email;
                sessionStorage.setItem('resetEmail', email);
                // Update hint text with masked email
                const hint = document.getElementById('reset-otp-hint');
                if (hint) {
                    const parts  = email.split('@');
                    const masked = parts[0].substring(0, 2) + '***@' + parts[1];
                    hint.textContent = `A 6-digit code was sent to ${masked}`;
                }
                showPanel('reset-otp');
                startResendCountdown(60);
            } else {
                showError(result.error || 'Something went wrong. Please try again.');
            }
        } catch (err) {
            showError('An error occurred. Please try again.');
        } finally {
            setButtonLoading(btn, false);
        }
    });
}

// ── Forgot: Step 2 — Verify Reset OTP ────────────────────────────────────────
const resetOtpForm = document.getElementById('reset-otp-form');
if (resetOtpForm) {
    resetOtpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const otp = document.getElementById('reset-otp-input').value.trim();
        const btn = document.getElementById('reset-otp-submit-btn');

        if (otp.length !== 6) {
            showError('Please enter the full 6-digit code.');
            return;
        }

        setButtonLoading(btn, true);
        try {
            const res    = await fetch('/api/verify-reset-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: resetEmail, otp }),
                credentials: 'include'
            });
            const result = await res.json();

            if (res.ok && result.success) {
                clearInterval(resendTimerInterval);
                showPanel('new-password');
            } else {
                showError(result.error || 'Invalid or expired code. Please try again.');
            }
        } catch (err) {
            showError('An error occurred. Please try again.');
        } finally {
            setButtonLoading(btn, false);
        }
    });
}

// ── Forgot: Step 3 — Set New Password ────────────────────────────────────────
const newPasswordForm = document.getElementById('new-password-form');
if (newPasswordForm) {
    newPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPwd     = document.getElementById('new-password-input').value;
        const confirmPwd = document.getElementById('confirm-password-input').value;
        const matchErr   = document.getElementById('pwd-match-error');
        const btn        = document.getElementById('new-password-submit-btn');

        // Client-side validation
        if (newPwd.length < 8) {
            showError('Password must be at least 8 characters.');
            return;
        }
        if (newPwd !== confirmPwd) {
            if (matchErr) matchErr.classList.remove('d-none');
            return;
        }
        if (matchErr) matchErr.classList.add('d-none');

        setButtonLoading(btn, true);
        try {
            const res    = await fetch('/api/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword: newPwd }),
                credentials: 'include'
            });
            const result = await res.json();

            if (res.ok && result.success) {
                // Clear state
                resetEmail = '';
                sessionStorage.removeItem('resetEmail');
                // Show success then redirect to login
                alert('✅ Password updated successfully! Please log in with your new password.');
                showPanel('login');
                // Clear new password fields
                document.getElementById('new-password-input').value    = '';
                document.getElementById('confirm-password-input').value = '';
                const fill  = document.getElementById('pwd-strength-fill');
                const label = document.getElementById('pwd-strength-label');
                if (fill)  { fill.style.width = '0%'; }
                if (label) { label.textContent = '—'; label.style.color = '#aaa'; }
            } else {
                showError(result.error || 'Failed to update password. Please try again.');
                // If session expired, restart the flow
                if (res.status === 403) {
                    showPanel('forgot');
                }
            }
        } catch (err) {
            showError('An error occurred. Please try again.');
        } finally {
            setButtonLoading(btn, false);
        }
    });

    // Live password match check
    const confirmInput = document.getElementById('confirm-password-input');
    if (confirmInput) {
        confirmInput.addEventListener('input', () => {
            const matchErr = document.getElementById('pwd-match-error');
            if (!matchErr) return;
            const newPwd = document.getElementById('new-password-input').value;
            if (confirmInput.value && confirmInput.value !== newPwd) {
                matchErr.classList.remove('d-none');
            } else {
                matchErr.classList.add('d-none');
            }
        });
    }
}
