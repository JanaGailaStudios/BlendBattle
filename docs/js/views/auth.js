/* Blend Battles — auth dialogs (sign in / register / guest) */
import { login, register, guest, state, refreshMe, requestRerender, loadConfig } from '../core.js';
import { openModal, closeModal, toast } from '../ui.js';

function fieldHTML({ id, label, type = 'text', placeholder = '', autocomplete = '', hint = '' }) {
  return `<div class="field" id="f-${id}">
    <label for="${id}">${label}</label>
    <input class="input" id="${id}" type="${type}" placeholder="${placeholder}" autocomplete="${autocomplete}" />
    ${hint ? `<span class="field__hint">${hint}</span>` : ''}
    <span class="field__error"></span>
  </div>`;
}

function setError(root, id, msg) {
  const f = root.querySelector('#f-' + id);
  if (!f) return;
  f.classList.toggle('has-error', !!msg);
  const e = f.querySelector('.field__error');
  if (e) e.textContent = msg || '';
}

export function openAuthModal({ mode = 'login', reason = '' } = {}) {
  let current = mode;
  const render = (root) => {
    const demoAccounts = (state.config && state.config.demoAccounts) || [];
    root.querySelector('.modal').innerHTML = `
      <div class="modal__head">
        <div>
          <div class="modal__title">${current === 'login' ? 'Welcome back, artist' : 'Join Blend Battles'}</div>
          <div class="modal__sub">${reason ? reason : current === 'login'
            ? 'Sign in to keep your XP, rank and submission history.'
            : 'Create an account to hold a rank, keep a gallery and compete in tournaments.'}</div>
        </div>
        <button class="modal__x" data-close aria-label="Close">×</button>
      </div>
      <div class="modal__body">
        <div class="tabs" style="margin-bottom:16px">
          <button class="tab ${current === 'login' ? 'is-active' : ''}" data-tab="login">Sign in</button>
          <button class="tab ${current === 'register' ? 'is-active' : ''}" data-tab="register">Create account</button>
        </div>
        <form id="authForm" class="stack" novalidate>
          ${fieldHTML({ id: 'username', label: 'Username', placeholder: 'e.g. vertexVixen', autocomplete: 'username' })}
          ${current === 'register' ? fieldHTML({ id: 'email', label: 'Email', type: 'email', placeholder: 'you@studio.com', autocomplete: 'email' }) : ''}
          ${fieldHTML({ id: 'password', label: 'Password', type: 'password', placeholder: current === 'register' ? 'At least 8 characters' : '••••••••', autocomplete: current === 'register' ? 'new-password' : 'current-password' })}
          <div class="field__error" id="formErr" style="display:none"></div>
          <button class="btn btn--primary btn--block" type="submit" id="authSubmit">
            ${current === 'login' ? 'Sign in' : 'Create account & play'}
          </button>
        </form>
        <div class="divider"></div>
        <button class="btn btn--ghost btn--block" id="guestBtn">Continue as guest →</button>
        <p class="note" style="margin-top:10px">Guest mode is a real, working session on this demo server: you can play, upload and vote, but your progress lives in this browser session and cannot be recovered.</p>
        ${demoAccounts.length ? `<div class="callout callout--info" style="margin-top:14px;font-size:12px">
          <b>Demo accounts</b> — password <code>blendbattles</code><br />
          ${demoAccounts.map((a) => `<button class="btn btn--sm btn--ghost" data-demo="${a.username}" style="margin:6px 6px 0 0">${a.username} <span class="dim">· ${a.note}</span></button>`).join('')}
        </div>` : ''}
      </div>`;
    if (current === 'login') root.querySelector('#username').value = localStorage.getItem('bb_lastUser') || '';
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      current = b.dataset.tab;
      render(root);
    }));
    root.querySelector('#guestBtn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.classList.add('is-loading');
      try {
        const u = await guest();
        closeModal();
        toast(`Signed in as ${u.username}. You're in the arena.`, { type: 'success', title: 'Guest session started' });
        requestRerender();
      } catch (err) {
        toast(err.message, { type: 'error' });
      } finally { btn.classList.remove('is-loading'); }
    });
    root.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', async () => {
      root.querySelector('#username').value = b.dataset.demo;
      root.querySelector('#password').value = 'blendbattles';
      root.querySelector('#authForm').requestSubmit();
    }));
    root.querySelector('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = root.querySelector('#username').value.trim();
      const password = root.querySelector('#password').value;
      const emailEl = root.querySelector('#email');
      const email = emailEl ? emailEl.value.trim() : '';
      let ok = true;
      setError(root, 'username', ''); setError(root, 'password', ''); if (emailEl) setError(root, 'email', '');
      const formErr = root.querySelector('#formErr');
      formErr.style.display = 'none';
      if (!/^[A-Za-z0-9_]{3,18}$/.test(username)) { setError(root, 'username', '3–18 characters, letters / numbers / underscore.'); ok = false; }
      if (password.length < 8) { setError(root, 'password', 'Password must be at least 8 characters.'); ok = false; }
      if (emailEl && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { setError(root, 'email', 'Enter a valid email address.'); ok = false; }
      if (!ok) return;
      const btn = root.querySelector('#authSubmit');
      btn.classList.add('is-loading');
      try {
        const user = current === 'login' ? await login(username, password) : await register({ username, email, password });
        localStorage.setItem('bb_lastUser', user.username);
        closeModal();
        toast(`Welcome ${current === 'login' ? 'back' : ''}, ${user.username}.`, { type: 'success', title: current === 'login' ? 'Signed in' : 'Account created' });
        requestRerender();
      } catch (err) {
        formErr.textContent = err.message;
        formErr.style.display = 'block';
        btn.classList.remove('is-loading');
      }
    });
  };
  const inst = openModal({
    title: current === 'login' ? 'Sign in' : 'Create account',
    body: '',
    onMount: (root) => {
      render(root);
    },
  });
  return inst;
}

/** Show the auth modal if the visitor is not signed in. Returns true when signed in. */
export function requireAuth(reason = 'Sign in to continue.') {
  if (state.user) return true;
  openAuthModal({ reason });
  return false;
}
