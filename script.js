// ✅ BOOTSTRAP
document.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        // Only redirect if we ARE on the auth page
        if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
            window.location.href = '/dashboard.html';
        }
    }
    initTheme();
    initApp();
});

// 🌗 THEME ENGINE
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.body.setAttribute('data-theme', savedTheme); // Backup for some CSS selectors
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
}

// 🔔 NOTIFICATION SYSTEM (TOAST)
function toast(msg, type = 'success') {
    const toastEl = document.getElementById('toast');
    if (!toastEl) return alert(msg);
    toastEl.textContent = msg;
    toastEl.className = `toast show ${type}`;
    setTimeout(() => { toastEl.className = 'toast'; }, 3000);
}

// 📑 NAVIGATION
window.switchTab = (type) => {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const verifyForm = document.getElementById('verify-form');
    const tabSlider = document.getElementById('tab-slider');
    const btnLogin = document.getElementById('btn-login');
    const btnSignup = document.getElementById('btn-signup');
    const tabsContainer = document.getElementById('tabs-container');

    if (!loginForm || !signupForm) return console.error('Forms missing');

    loginForm.classList.remove('active');
    signupForm.classList.remove('active');
    if (verifyForm) verifyForm.classList.remove('active');
    if (tabsContainer) tabsContainer.style.display = 'flex';

    if (btnLogin) btnLogin.classList.toggle('active', type === 'login');
    if (btnSignup) btnSignup.classList.toggle('active', type === 'signup');
    
    if (tabSlider) {
        tabSlider.style.transform = `translateX(${type === 'signup' ? '100%' : '0%'})`;
    }

    if (type === 'login') loginForm.classList.add('active');
    if (type === 'signup') signupForm.classList.add('active');
};

window.resetToLogin = () => switchTab('login');

// 🔐 AUTH HANDLERS
window.handleLogin = async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.user) {
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            window.location.href = '/dashboard.html';
        } else toast(data.error || 'Identity rejection', 'error');
    } catch(e) { toast('Infrastructure offline', 'error'); }
};

window.handleSignUp = async (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    
    try {
        const res = await fetch('/api/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('login-form').classList.remove('active');
            document.getElementById('signup-form').classList.remove('active');
            const vf = document.getElementById('verify-form');
            if (vf) vf.classList.add('active');
            const tc = document.getElementById('tabs-container');
            if (tc) tc.style.display = 'none';
            toast('Genesis Code dispatched to ' + email);
        } else toast(data.error || 'Protocol fault', 'error');
    } catch(e) { toast('Registry failure', 'error'); }
};

window.handleVerify = async (e) => {
    e.preventDefault();
    const email = document.getElementById('signup-email').value;
    const otp = document.getElementById('verify-code').value;
    
    try {
        const res = await fetch('/api/verify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp })
        });
        if (res.ok) {
            toast('Account Synthesized! Access granted.');
            setTimeout(() => resetToLogin(), 1500);
        } else toast('Invalid Activation Signal', 'error');
    } catch(e) { toast('Security leak detected', 'error'); }
};

function initApp() {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) themeToggle.onclick = toggleTheme;
}
