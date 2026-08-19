/**
 * LVOAuthWidget — mounts a sign-in / sign-up / 2FA / forgot-password form.
 * Usage: LVOAuthWidget.mount(el, { division: 'Alliance', onAuthenticated: (user) => {} })
 * `division` is fixed per-site: the Alliance site always passes 'Alliance',
 * the Vindex site always passes 'Vindex', etc. That's what makes login
 * "universal but separated by division" — same worker, same credentials
 * system, but each site only ever authenticates against its own division.
 *
 * Color: the widget uses `var(--accent, #7F77DD)` throughout instead of a
 * hardcoded color, so it automatically picks up whichever accent color the
 * host page defines in :root (gold for Vindex, green for Ops, etc.).
 * Falls back to purple (#7F77DD) only if the host page defines no --accent.
 *
 * Password resets are not self-service: there is no reset-by-email flow on
 * the worker. "Forgot password" simply directs the member to LVO Administration.
 */
const LVOAuthWidget = (function () {
  const RECOVERY_EMAIL = 'accountrecovery@wearelvo.com';

  function h(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v);
    });
    children.forEach((c) => c && e.appendChild(c));
    return e;
  }

  function injectStyle(container) {
    if (container.querySelector('style[data-lvo-auth]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-lvo-auth', '');
    style.textContent = `
      .lvo-auth{width:100%;max-width:340px;font-family:'Cormorant Garamond',Georgia,serif;color:#F0EEEC}
      .lvo-auth-tabs{display:flex;margin-bottom:1.4rem;border-bottom:.5px solid color-mix(in srgb, var(--accent, #7F77DD) 20%, transparent)}
      .lvo-auth-tab{flex:1;background:none;border:none;color:#888880;font-family:'Cinzel',serif;font-size:.42rem;letter-spacing:.25em;text-transform:uppercase;padding:.7rem 0;cursor:pointer;border-bottom:2px solid transparent;transition:color .2s,border-color .2s}
      .lvo-auth-tab.active{color:var(--accent, #7F77DD);border-bottom-color:var(--accent, #7F77DD)}
      .lvo-field{margin-bottom:.9rem;text-align:left}
      .lvo-field label{display:block;font-family:'Cinzel',serif;font-size:.36rem;letter-spacing:.3em;color:#888880;text-transform:uppercase;margin-bottom:.4rem}
      .lvo-field input{width:100%;background:transparent;border:.5px solid color-mix(in srgb, var(--accent, #7F77DD) 30%, transparent);color:#F0EEEC;font-family:'Cormorant Garamond',serif;font-size:.95rem;padding:.65rem .8rem;outline:none;box-sizing:border-box;transition:border-color .25s}
      .lvo-field input:focus{border-color:var(--accent, #7F77DD)}
      .lvo-row{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
      .lvo-btn{width:100%;background:transparent;border:.5px solid var(--accent, #7F77DD);color:var(--accent, #7F77DD);font-family:'Cinzel',serif;font-size:.46rem;letter-spacing:.3em;padding:.8rem;cursor:pointer;text-transform:uppercase;margin-top:.4rem;transition:background .25s,color .25s;box-sizing:border-box;text-decoration:none;display:block;text-align:center}
      .lvo-btn:hover{background:var(--accent, #7F77DD);color:#000}
      .lvo-btn:disabled{opacity:.4;cursor:not-allowed}
      .lvo-err{color:#CC2020;font-size:.8rem;font-style:italic;margin-top:.6rem;min-height:1.2em}
      .lvo-msg{color:#888880;font-size:.85rem;font-style:italic;margin-bottom:1.1rem;line-height:1.7;text-align:center}
      .lvo-code-input{letter-spacing:.6em !important;text-align:center;font-size:1.2rem !important}
      .lvo-resend{display:block;width:100%;text-align:center;background:none;border:none;color:var(--accent, #7F77DD);font-family:'Cinzel',serif;font-size:.36rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;margin-top:.9rem;padding:.4rem}
      .lvo-back{display:block;width:100%;text-align:center;background:none;border:none;color:#6A6A64;font-family:'Cinzel',serif;font-size:.34rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;margin-top:.5rem;padding:.3rem}
      .lvo-forgot{display:block;width:100%;text-align:center;background:none;border:none;color:#6A6A64;font-family:'Cinzel',serif;font-size:.34rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;margin-top:.7rem;padding:.3rem;transition:color .2s}
      .lvo-forgot:hover{color:var(--accent, #7F77DD)}
      .lvo-recovery-email{display:block;color:var(--accent, #7F77DD);font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.15em;text-align:center;margin:.9rem 0 1.3rem;word-break:break-all}
    `;
    container.appendChild(style);
  }

  function mount(container, { division = 'Alliance', onAuthenticated } = {}) {
    container.innerHTML = '';
    injectStyle(container);

    const wrap = h('div', { class: 'lvo-auth' });
    container.appendChild(wrap);

    let mode = 'login'; // 'login' | 'signup'
    let pending = null; // { userId, email, purpose }

    function setError(msg) {
      const e = wrap.querySelector('.lvo-err');
      if (e) e.textContent = msg || '';
    }

    function fieldEl(name, label, type, extra = {}) {
      const f = h('div', { class: 'lvo-field' });
      f.appendChild(h('label', { text: label }));
      f.appendChild(h('input', { name, type, ...extra }));
      return f;
    }

    function val(name) {
      const input = wrap.querySelector(`input[name="${name}"]`);
      return input ? input.value.trim() : '';
    }

    function renderAuthForm() {
      pending = null;
      wrap.innerHTML = '';
      const tabs = h('div', { class: 'lvo-auth-tabs' }, [
        h('button', {
          class: 'lvo-auth-tab' + (mode === 'login' ? ' active' : ''),
          type: 'button',
          text: 'Sign In',
          onClick: () => { mode = 'login'; renderAuthForm(); },
        }),
        h('button', {
          class: 'lvo-auth-tab' + (mode === 'signup' ? ' active' : ''),
          type: 'button',
          text: 'Sign Up',
          onClick: () => { mode = 'signup'; renderAuthForm(); },
        }),
      ]);
      wrap.appendChild(tabs);

      const form = h('form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        mode === 'login' ? doLogin() : doSignup();
      });

      if (mode === 'signup') {
        const row = h('div', { class: 'lvo-row' });
        row.appendChild(fieldEl('firstName', 'First Name', 'text', { autocomplete: 'given-name' }));
        row.appendChild(fieldEl('lastName', 'Last Name', 'text', { autocomplete: 'family-name' }));
        form.appendChild(row);
        form.appendChild(fieldEl('username', 'Username', 'text', { autocomplete: 'username' }));
        form.appendChild(fieldEl('email', 'Email', 'email', { autocomplete: 'email' }));
      } else {
        form.appendChild(fieldEl('identifier', 'Email or Username', 'text', { autocomplete: 'username' }));
      }
      form.appendChild(fieldEl('password', 'Password', 'password', {
        autocomplete: mode === 'login' ? 'current-password' : 'new-password',
      }));
      form.appendChild(h('div', { class: 'lvo-err' }));
      form.appendChild(h('button', {
        class: 'lvo-btn',
        type: 'submit',
        text: mode === 'login' ? 'Sign In →' : 'Create Account →',
      }));
      wrap.appendChild(form);

      if (mode === 'login') {
        wrap.appendChild(h('button', {
          class: 'lvo-forgot',
          type: 'button',
          text: 'Forgot Password?',
          onClick: renderForgotPassword,
        }));
      }
    }

    function renderForgotPassword() {
      wrap.innerHTML = '';
      wrap.appendChild(h('div', {
        class: 'lvo-msg',
        text: 'Password resets aren\u2019t self-service. Email LVO Administration from your registered address and we\u2019ll verify you and restore access.',
      }));
      wrap.appendChild(h('a', {
        class: 'lvo-recovery-email',
        href: `mailto:${RECOVERY_EMAIL}`,
        text: RECOVERY_EMAIL,
      }));
      wrap.appendChild(h('a', {
        class: 'lvo-btn',
        href: `mailto:${RECOVERY_EMAIL}?subject=${encodeURIComponent('Account Recovery — ' + division)}`,
        text: 'Email Account Recovery →',
      }));
      wrap.appendChild(h('button', { class: 'lvo-back', type: 'button', text: '\u2190 Back to Sign In', onClick: renderAuthForm }));
    }

    async function doLogin() {
      setError('');
      const identifier = val('identifier'), password = val('password');
      if (!identifier || !password) return setError('Email/username and password required.');
      const btn = wrap.querySelector('.lvo-btn');
      btn.disabled = true;
      try {
        const data = await LVOAuth.login({ identifier, password, division });
        pending = { userId: data.userId, email: data.email, purpose: 'login' };
        renderCodeForm();
      } catch (e) {
        setError((e.data && e.data.error) || e.message);
        btn.disabled = false;
      }
    }

    async function doSignup() {
      setError('');
      const firstName = val('firstName'), lastName = val('lastName'), username = val('username'),
        email = val('email'), password = val('password');
      if (!firstName || !lastName || !username || !email || !password) return setError('All fields are required.');
      if (password.length < 8) return setError('Password must be at least 8 characters.');
      const btn = wrap.querySelector('.lvo-btn');
      btn.disabled = true;
      try {
        const data = await LVOAuth.signup({ firstName, lastName, username, email, password, division });
        pending = { userId: data.userId, email: data.email, purpose: 'verify' };
        renderCodeForm();
      } catch (e) {
        setError((e.data && e.data.error) || e.message);
        btn.disabled = false;
      }
    }

    function renderCodeForm() {
      wrap.innerHTML = '';
      wrap.appendChild(h('div', {
        class: 'lvo-msg',
        text: `A 6-digit code was sent to ${pending.email}. Enter it below to continue.`,
      }));
      const form = h('form');
      form.addEventListener('submit', (e) => { e.preventDefault(); doVerify(); });
      form.appendChild(fieldEl('code', 'Verification Code', 'text', {
        maxlength: '6',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
        class: 'lvo-code-input',
      }));
      form.appendChild(h('div', { class: 'lvo-err' }));
      form.appendChild(h('button', { class: 'lvo-btn', type: 'submit', text: 'Verify →' }));
      wrap.appendChild(form);
      wrap.appendChild(h('button', { class: 'lvo-resend', type: 'button', text: 'Resend Code', onClick: doResend }));
      wrap.appendChild(h('button', { class: 'lvo-back', type: 'button', text: '← Back', onClick: renderAuthForm }));
    }

    async function doVerify() {
      setError('');
      const code = val('code');
      if (!code) return setError('Enter the code.');
      const btn = wrap.querySelector('.lvo-btn');
      btn.disabled = true;
      try {
        const data = await LVOAuth.verify({ userId: pending.userId, code, purpose: pending.purpose });
        if (onAuthenticated) onAuthenticated(data.user);
      } catch (e) {
        setError((e.data && e.data.error) || e.message);
        btn.disabled = false;
      }
    }

    async function doResend() {
      try {
        await LVOAuth.resend({ userId: pending.userId, purpose: pending.purpose });
        setError('Code resent.');
      } catch (_) {
        setError('Failed to resend code.');
      }
    }

    renderAuthForm();
  }

  return { mount };
})();
