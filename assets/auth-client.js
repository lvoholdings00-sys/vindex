/**
 * LVOAuth — thin client for the custom D1-backed auth on the worker.
 * Shared across Alliance / Vindex / Ops. Division is passed in per-call
 * by whichever site is using it (see LVOAuthWidget.mount({ division })).
 */
const LVOAuth = (function () {
  const WORKER = 'https://lvo-worker.lvoholdings00.workers.dev';
  const STORAGE_KEY = 'lvo_token';

  function getToken() {
    // Pick up a token handed off via ?lvo_token=... (e.g. landing page -> dashboard redirect)
    try {
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get('lvo_token');
      if (fromUrl) {
        localStorage.setItem(STORAGE_KEY, fromUrl);
        url.searchParams.delete('lvo_token');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (_) {}
    return localStorage.getItem(STORAGE_KEY) || '';
  }

  function setToken(token) {
    if (token) localStorage.setItem(STORAGE_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(STORAGE_KEY);
  }

  async function request(path, opts = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(WORKER + path, { ...opts, headers });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const e = new Error((data && data.error) || `Request failed (${res.status})`);
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  async function signup({ firstName, lastName, username, email, password, division }) {
    return request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ firstName, lastName, username, email, password, division }),
    });
  }

  async function login({ identifier, password, division }) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, division }),
    });
  }

  async function resend({ userId, purpose }) {
    return request('/auth/resend', { method: 'POST', body: JSON.stringify({ userId, purpose }) });
  }

  async function verify({ userId, code, purpose }) {
    const data = await request('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ userId, code, purpose }),
    });
    if (data && data.token) setToken(data.token);
    return data;
  }

  async function session() {
    try {
      const data = await request('/auth/session', { method: 'GET' });
      return data.user;
    } catch (_) {
      return null;
    }
  }

  async function logout() {
    try { await request('/auth/logout', { method: 'POST' }); } catch (_) {}
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
    signup,
    login,
    resend,
    verify,
    session,
    logout,
    updateProfile,
    myDeals,
    _request: request, // exposed for dashboard.html to reuse (WORKER-authed fetches)
    WORKER,
  };
})();
