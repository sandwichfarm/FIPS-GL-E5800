'use strict';

function sessionHeaders(browser) {
  const token = browser.$getCookie && browser.$getCookie('Admin-Token');
  if (!/^[A-Za-z0-9]{32}$/.test(token || '')) {
    throw new Error('Admin session expired. Sign in again.');
  }
  return { 'Content-Type': 'application/json', 'X-GL-Admin-Token': token };
}

function createApi(browser = window, transport = fetch) {
  return async function request(operation, parameters = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),
      operation === 'activate' || operation === 'confirm' ? 22000 : 7000);
    try {
      const response = await transport('/cgi-bin/gl-sdk4-ui-fips', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: sessionHeaders(browser),
        body: JSON.stringify({ ...parameters, operation }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error('Admin session expired or access denied. Sign in again.');
      }
      if (!response.ok) throw new Error(`Router request failed (${response.status}).`);
      const body = await response.json();
      if (body.status !== 'ok') throw new Error(body.error || 'Router request failed.');
      return body.data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Router did not respond in time.');
      throw error;
    } finally { clearTimeout(timer); }
  };
}

module.exports = { createApi, sessionHeaders };
