/**
 * LVOAuth — client for LVO Cloud, the single sign-in system for every LVO site.
 * Sign-in is username-or-email + password, then a 2-step code from an
 * authenticator app (first sign-in walks the member through enrolling one).
 * Shared across Alliance / Vindex / Ops (landing sites and dashboards).
 *
 * Auth lives on LVO Cloud (AUTH). Dashboard data (deals, announcements,
 * members...) is still served by the data worker (WORKER) and receives the
 * same Bearer token.
 */
const LVOAuth = (function () {
  const AUTH = 'https://lvo-cloud.cloud';
  const WORKER = 'https://lvo-worker.lvoholdings00.workers.dev'; // dashboard data
  const STORAGE_KEY = 'lvo_token';

  // Each site only ever signs in against its own division.
  function currentDivision() {
    const h = (location.hostname || '').toLowerCase();
    if (h.includes('vindex')) return 'Vindex';
    if (h.includes('alliance')) return 'Alliance';
    if (h.split('.').includes('ops')) return 'Ops';
    return '';
  }

  function getToken() {
    // Pick up a token handed off via ?lvo_token=... (landing page -> dashboard redirect)
    try {
      const url = new URL(window.location.href);
      // Preferred handoff: URL fragment (#lvo_token=...). Fragments are never sent
      // to servers or in Referer headers, unlike a query string.
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const fromHash = hashParams.get('lvo_token');
      if (fromHash) {
        localStorage.setItem(STORAGE_KEY, fromHash);
        // Remove only the token; leave any other fragment (e.g. a hash route) untouched.
        url.hash = window.location.hash.replace(/^#/, '').replace(/(^|&)lvo_token=[^&]*/, '').replace(/^&/, '');
        window.history.replaceState({}, '', url.toString());
      }
      // Legacy query-string handoff, still accepted so old links keep working.
      const fromUrl = url.searchParams.get('lvo_token');
      if (fromUrl) {
        localStorage.setItem(STORAGE_KEY, fromUrl);
        url.searchParams.delete('lvo_token');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (_) {}
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { return ''; }
  }

  function setToken(token) {
    try { if (token) localStorage.setItem(STORAGE_KEY, token); } catch (_) {}
  }

  function clearToken() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  async function call(base, path, opts = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(base + path, { ...opts, headers });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const e = new Error((data && data.error) || `Request failed (${res.status})`);
      e.status = res.status;
      e.data = data;
      e.code = data && data.code;
      throw e;
    }
    return data;
  }

  const authRequest = (path, opts) => call(AUTH, path, opts);
  const request = (path, opts) => call(WORKER, path, opts);

  // Step 1: identifier + password. Resolves to
  //   { status: 'MFA_VERIFY_REQUIRED', userId }                     (already enrolled)
  //   { status: 'MFA_SETUP_REQUIRED', userId, secret, otpUri }      (first sign-in)
  async function login({ identifier, password, division }) {
    return authRequest('/api/auth/login-step1', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, division: division || currentDivision() }),
    });
  }

  // Step 2 (enrolled): 6-digit code from the authenticator app.
  async function verifyMfa({ userId, code, division }) {
    const data = await authRequest('/api/auth/mfa-verify', {
      method: 'POST',
      body: JSON.stringify({ userId, code, division: division || currentDivision() }),
    });
    if (data && data.token) setToken(data.token);
    return data;
  }

  // Step 2 (first sign-in): confirm the code from the newly scanned authenticator.
  async function confirmMfaSetup({ userId, code, division }) {
    const data = await authRequest('/api/auth/mfa-confirm-setup', {
      method: 'POST',
      body: JSON.stringify({ userId, code, division: division || currentDivision() }),
    });
    if (data && data.token) setToken(data.token);
    return data;
  }

  // The signed-in member, scoped to this site's division (division / tier / role
  // come from their grant). null if signed out or without access to this division.
  async function session() {
    if (!getToken()) return null;
    const div = currentDivision();
    try {
      const data = await authRequest('/api/auth/me' + (div ? '?division=' + encodeURIComponent(div) : ''), { method: 'GET' });
      return data && data.authenticated ? data.user : null;
    } catch (_) {
      return null;
    }
  }

  async function logout() {
    try { await authRequest('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    clearToken();
  }

  async function updateProfile(fields) {
    const data = await request('/auth/profile', { method: 'PUT', body: JSON.stringify(fields) });
    return data.user;
  }

  async function myDeals() {
    try {
      const data = await request('/auth/me/deals', { method: 'GET' });
      return data.deals || [];
    } catch (_) {
      return [];
    }
  }

  return {
    getToken,
    setToken,
    clearToken,
    login,
    verifyMfa,
    confirmMfaSetup,
    session,
    logout,
    updateProfile,
    myDeals,
    currentDivision,
    _request: request, // dashboard data calls (Bearer-authed)
    WORKER,
    AUTH,
  };
})();
