/**
 * LVOAuthWidget — mounts the LVO Cloud sign-in form: username/email + password,
 * then a 2-step code from an authenticator app (with first-time enrollment).
 * Usage: LVOAuthWidget.mount(el, { division: 'Alliance', onAuthenticated: (user) => {} })
 * `division` is fixed per-site: the Alliance site always passes 'Alliance',
 * the Vindex site always passes 'Vindex', etc. That's what makes login
 * "universal but separated by division" — same worker, same credentials
 * system, but each site only ever authenticates against its own division.
 *
 * Color: the widget uses `var(--accent, #A359EC)` throughout instead of a
 * hardcoded color, so it automatically picks up whichever accent color the
 * host page defines in :root (gold for Vindex, green for Ops, etc.).
 * Falls back to purple (#A359EC) only if the host page defines no --accent.
 *
 * Password resets are not self-service: there is no reset-by-email flow on
 * the worker. "Forgot password" simply directs the member to LVO Administration.
 *
 * Sign-up is intentionally not offered here. Membership on these sites is
 * by invitation/review only — visitors who want in are pointed to
 * REQUEST_EMAIL so LVO Administration can vet and provision an account.
 */
const LVOAuthWidget = (function () {
  const RECOVERY_EMAIL = 'accountrecovery@wearelvo.com';
  const REQUEST_EMAIL = 'join@wearelvo.com';

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
      .lvo-auth-tabs{display:flex;margin-bottom:1.4rem;border-bottom:.5px solid color-mix(in srgb, var(--accent, #A359EC) 20%, transparent)}
      .lvo-auth-tab{flex:1;background:none;border:none;color:#888880;font-family:'Cinzel',serif;font-size:.42rem;letter-spacing:.25em;text-transform:uppercase;padding:.7rem 0;cursor:pointer;border-bottom:2px solid transparent;transition:color .2s,border-color .2s}
      .lvo-auth-tab.active{color:var(--accent, #A359EC);border-bottom-color:var(--accent, #A359EC)}
      .lvo-field{margin-bottom:.9rem;text-align:left}
      .lvo-field label{display:block;font-family:'Cinzel',serif;font-size:.36rem;letter-spacing:.3em;color:#888880;text-transform:uppercase;margin-bottom:.4rem}
      .lvo-field input{width:100%;background:transparent;border:.5px solid color-mix(in srgb, var(--accent, #A359EC) 30%, transparent);color:#F0EEEC;font-family:'Cormorant Garamond',serif;font-size:.95rem;padding:.65rem .8rem;outline:none;box-sizing:border-box;transition:border-color .25s}
      .lvo-field input:focus{border-color:var(--accent, #A359EC)}
      .lvo-row{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
      .lvo-btn{width:100%;background:transparent;border:.5px solid var(--accent, #A359EC);color:var(--accent, #A359EC);font-family:'Cinzel',serif;font-size:.46rem;letter-spacing:.3em;padding:.8rem;cursor:pointer;text-transform:uppercase;margin-top:.4rem;transition:background .25s,color .25s;box-sizing:border-box;text-decoration:none;display:block;text-align:center}
      .lvo-btn:hover{background:var(--accent, #A359EC);color:#000}
      .lvo-btn:disabled{opacity:.4;cursor:not-allowed}
      .lvo-err{color:#CC2020;font-size:.8rem;font-style:italic;margin-top:.6rem;min-height:1.2em}
      .lvo-msg{color:#888880;font-size:.85rem;font-style:italic;margin-bottom:1.1rem;line-height:1.7;text-align:center}
      .lvo-code-input{letter-spacing:.6em !important;text-align:center;font-size:1.2rem !important}
      .lvo-resend{display:block;width:100%;text-align:center;background:none;border:none;color:var(--accent, #A359EC);font-family:'Cinzel',serif;font-size:.36rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;margin-top:.9rem;padding:.4rem}
      .lvo-back{display:block;width:100%;text-align:center;background:none;border:none;color:#6A6A64;font-family:'Cinzel',serif;font-size:.34rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;margin-top:.5rem;padding:.3rem}
      .lvo-forgot{display:block;width:100%;text-align:center;background:none;border:none;color:#6A6A64;font-family:'Cinzel',serif;font-size:.34rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;margin-top:.7rem;padding:.3rem;transition:color .2s}
      .lvo-forgot:hover{color:var(--accent, #A359EC)}
      .lvo-recovery-email{display:block;color:var(--accent, #A359EC);font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.15em;text-align:center;margin:.9rem 0 1.3rem;word-break:break-all}
      .lvo-request{display:block;width:100%;text-align:center;background:none;border:none;color:#6A6A64;font-family:'Cinzel',serif;font-size:.34rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;margin-top:1.1rem;padding:.3rem;text-decoration:none;transition:color .2s}
      .lvo-request:hover{color:var(--accent, #A359EC)}
    `;
    container.appendChild(style);
  }

  function loadQr(cb) {
    if (window.QRCode) return cb(true);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = () => cb(!!window.QRCode);
    s.onerror = () => cb(false);
    document.head.appendChild(s);
  }

  function mount(container, { division = 'Alliance', onAuthenticated } = {}) {
    container.innerHTML = '';
    injectStyle(container);

    const wrap = h('div', { class: 'lvo-auth' });
    container.appendChild(wrap);

    let pending = null; // { userId, mode: 'verify' | 'setup', secret, otpUri }

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

    function errText(e) {
      if (e.code === 'WRONG_DIVISION') {
        return 'This account doesn\u2019t have access to this division. Contact LVO Administration.';
      }
      return (e.data && e.data.error) || e.message;
    }

    function renderAuthForm() {
      pending = null;
      wrap.innerHTML = '';

      const form = h('form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        doLogin();
      });

      form.appendChild(fieldEl('identifier', 'Username or Email', 'text', { autocomplete: 'username' }));
      form.appendChild(fieldEl('password', 'Password', 'password', { autocomplete: 'current-password' }));
      form.appendChild(h('div', { class: 'lvo-err' }));
      form.appendChild(h('button', { class: 'lvo-btn', type: 'submit', text: 'Sign In \u2192' }));
      wrap.appendChild(form);

      wrap.appendChild(h('button', {
        class: 'lvo-forgot',
        type: 'button',
        text: 'Forgot Password?',
        onClick: renderForgotPassword,
      }));

      wrap.appendChild(h('a', {
        class: 'lvo-request',
        href: `mailto:${REQUEST_EMAIL}?subject=${encodeURIComponent('Requesting Access \u2014 ' + division)}`,
        text: 'Not a Member? Request Access \u2192',
      }));
    }

    function renderForgotPassword() {
      wrap.innerHTML = '';
      wrap.appendChild(h('div', {
        class: 'lvo-msg',
        text: 'Password resets aren\u2019t self-service. Email LVO Administration from your registered address and we\u2019ll verify you and restore access.',
      }));
      wrap.appendChild(h('a', { class: 'lvo-recovery-email', href: `mailto:${RECOVERY_EMAIL}`, text: RECOVERY_EMAIL }));
      wrap.appendChild(h('a', {
        class: 'lvo-btn',
        href: `mailto:${RECOVERY_EMAIL}?subject=${encodeURIComponent('Account Recovery \u2014 ' + division)}`,
        text: 'Email Account Recovery \u2192',
      }));
      wrap.appendChild(h('button', { class: 'lvo-back', type: 'button', text: '\u2190 Back to Sign In', onClick: renderAuthForm }));
    }

    async function doLogin() {
      setError('');
      const identifier = val('identifier'), password = val('password');
      if (!identifier || !password) return setError('Username/email and password required.');
      const btn = wrap.querySelector('.lvo-btn');
      btn.disabled = true;
      try {
        const data = await LVOAuth.login({ identifier, password, division });
        pending = {
          userId: data.userId,
          mode: data.status === 'MFA_SETUP_REQUIRED' ? 'setup' : 'verify',
          secret: data.secret,
          otpUri: data.otpUri,
        };
        renderCodeForm();
      } catch (e) {
        setError(errText(e));
        btn.disabled = false;
      }
    }

    function renderCodeForm() {
      wrap.innerHTML = '';
      const setup = pending.mode === 'setup';

      wrap.appendChild(h('div', {
        class: 'lvo-msg',
        text: setup
          ? 'Set up 2-step verification. Scan this QR code with your authenticator app (Google Authenticator, Authy, Apple Passwords), then enter the 6-digit code it shows.'
          : 'Enter the 6-digit code from your authenticator app.',
      }));

      if (setup) {
        const qr = h('div', { style: 'display:flex;justify-content:center;margin:0 0 .8rem;background:#fff;padding:10px;width:fit-content;margin-left:auto;margin-right:auto' });
        wrap.appendChild(qr);
        loadQr((ok) => {
          if (ok && pending && pending.otpUri) {
            new window.QRCode(qr, { text: pending.otpUri, width: 160, height: 160, correctLevel: window.QRCode.CorrectLevel.M });
          } else {
            qr.remove();
          }
        });
        wrap.appendChild(h('div', { class: 'lvo-msg', text: 'Can\u2019t scan? Enter this key manually:' }));
        wrap.appendChild(h('div', { class: 'lvo-recovery-email', text: pending.secret || '' }));
      }

      const form = h('form');
      form.addEventListener('submit', (e) => { e.preventDefault(); doCode(); });
      form.appendChild(fieldEl('code', 'Authenticator Code', 'text', {
        maxlength: '6',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
        class: 'lvo-code-input',
      }));
      form.appendChild(h('div', { class: 'lvo-err' }));
      form.appendChild(h('button', { class: 'lvo-btn', type: 'submit', text: setup ? 'Activate & Sign In \u2192' : 'Verify \u2192' }));
      wrap.appendChild(form);
      wrap.appendChild(h('button', { class: 'lvo-back', type: 'button', text: '\u2190 Back', onClick: renderAuthForm }));
    }

    async function doCode() {
      setError('');
      const code = val('code');
      if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.');
      const btn = wrap.querySelector('.lvo-btn');
      btn.disabled = true;
      try {
        const args = { userId: pending.userId, code, division };
        const data = pending.mode === 'setup'
          ? await LVOAuth.confirmMfaSetup(args)
          : await LVOAuth.verifyMfa(args);
        if (onAuthenticated) onAuthenticated(data.user);
      } catch (e) {
        setError(errText(e));
        btn.disabled = false;
      }
    }

    renderAuthForm();
  }

  return { mount };
})();
