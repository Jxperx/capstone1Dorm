// Login form handling
const loginForm = document.querySelector('form[action="/api/login"]');
const otpForm = document.getElementById('otp-form');
const authTitle = document.querySelector('.auth-form h3');
const authDesc = document.querySelector('.auth-overlay p');

let tempUserId = null; // Store user ID temporarily for OTP verification

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    
    // Loading state
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Logging in...';
    submitBtn.disabled = true;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        
        if (response.ok) {
            if (result.otpRequired) {
                // Switch to OTP view
                loginForm.classList.add('d-none');
                otpForm.classList.remove('d-none');
                authTitle.textContent = 'Verification';
                authDesc.textContent = 'We sent a 6-digit code to your email. Please enter it below.';
                
                // Keep track of user if needed, though session handles it on server
            } else {
                // Direct login (Admin)
                window.location.href = result.role === 'admin' ? '/admin' : '/tenant';
            }
        } else {
            alert(result.error || 'Login failed');
        }
    } catch (err) {
        console.error(err);
        alert('An error occurred during login');
    } finally {
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
});

// OTP form handling
otpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const otpInput = otpForm.querySelector('input[name="otp"]');
    const otp = otpInput.value;
    const submitBtn = otpForm.querySelector('button[type="submit"]');

    // Loading state
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Verifying...';
    submitBtn.disabled = true;

    try {
        const response = await fetch('/api/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ otp })
        });
        const result = await response.json();

        if (response.ok) {
            window.location.href = '/tenant';
        } else {
            alert(result.error || 'Verification failed');
        }
    } catch (err) {
        console.error(err);
        alert('An error occurred during verification');
    } finally {
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
});

// Back to login button
document.getElementById('back-to-login').addEventListener('click', () => {
    otpForm.classList.add('d-none');
    loginForm.classList.remove('d-none');
    authTitle.textContent = 'Log In';
    authDesc.textContent = 'We missed you. Sign in to check your billing and messages.';
});
