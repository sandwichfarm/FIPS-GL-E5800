const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const preview = path.join(root, '.cache/web-preview');
const backend = path.join(root, 'apps/router-admin/target/release/fips-router-admin');
const socket = '/state/a/control.sock';
const state = '/state/a/router';
const token = 'a'.repeat(32);
const allowed = new Set(['status', 'peers', 'configuration', 'recovery', 'diagnostics']);

async function callBackend(body) {
  return new Promise((resolve, reject) => {
    const child = spawn(backend, ['--state-dir', state, '--socket', socket], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 262144) child.kill('SIGKILL');
    });
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(output)); }
      catch { reject(new Error('FIPS backend returned no valid JSON')); }
    });
    child.stdin.end(body);
  });
}

async function main() {
  const baseline = await callBackend(JSON.stringify({ operation: 'status' }));
  assert.equal(baseline.status, 'ok');
  assert.equal(baseline.data.state, 'running');
  assert.equal(baseline.data.persistent, true);
  assert.ok(baseline.data.link_count >= 1);
  assert.ok(baseline.data.npub.startsWith('npub1'));
  const peers = await callBackend(JSON.stringify({ operation: 'peers' }));
  assert.equal(peers.status, 'ok');
  assert.ok(peers.data.peers.length >= 1);

  const requests = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET' && (request.url === '/?live-backend=1' || request.url === '/preview.js')) {
      const file = request.url === '/preview.js' ? 'preview.js' : 'index.html';
      response.setHeader('Content-Type', file === 'index.html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
      fs.createReadStream(path.join(preview, file)).pipe(response);
      return;
    }
    if (request.url !== '/cgi-bin/gl-sdk4-ui-fips' || request.method !== 'POST' ||
        request.headers['x-gl-admin-token'] !== token) {
      response.writeHead(403).end();
      return;
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 32768) {
        response.writeHead(413).end();
        return;
      }
    }
    try {
      const operation = JSON.parse(body).operation;
      if (!allowed.has(operation)) {
        response.writeHead(403).end();
        return;
      }
      requests.push(operation);
      const result = await callBackend(body);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result));
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/?live-backend=1`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const pageErrors = [];
    const externalRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      if (!request.url().startsWith(`http://127.0.0.1:${server.address().port}/`)) {
        externalRequests.push(request.url());
      }
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByText(baseline.data.npub).waitFor();
    await page.getByText(peers.data.peers[0].display_name || peers.data.peers[0].npub).waitFor();
    assert.equal(await page.locator('.fips-panel dl dd').first().innerText(), 'running');
    await page.getByText('Live local FIPS lab backend. No router requests.').waitFor();
    await page.getByRole('button', { name: 'Check node health' }).click();
    await page.waitForFunction(() => document.querySelector('.fips-panel pre')?.textContent?.includes('"daemon_reachable": true'));
    assert.deepEqual(new Set(requests), new Set(allowed));
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(externalRequests, []);
    console.log('Live lab browser: FIPS identity, peer/status, configuration, recovery, diagnostics passed');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
