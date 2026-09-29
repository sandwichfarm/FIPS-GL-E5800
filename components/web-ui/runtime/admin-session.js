'use strict';

const ADMIN_SESSION_PATTERN = /^[0-9A-Za-z]{32}$/;

function getAdminSessionId(browser) {
  const runtime = browser || (typeof window !== 'undefined' ? window : null);
  const sid = runtime && typeof runtime.$getCookie === 'function'
    ? runtime.$getCookie('Admin-Token')
    : '';
  if (!ADMIN_SESSION_PATTERN.test(sid || '')) {
    throw new Error('SDK4 admin session is unavailable.');
  }
  return sid;
}

function createAdminSessionHeaders(browser, headers) {
  return Object.assign({}, headers || {}, {
    'X-GL-Admin-Token': getAdminSessionId(browser),
  });
}

module.exports = {
  ADMIN_SESSION_PATTERN,
  createAdminSessionHeaders,
  getAdminSessionId,
};
