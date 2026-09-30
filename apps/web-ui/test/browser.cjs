const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const preview = path.resolve(__dirname, '../../../.cache/web-preview');
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/preview.js': ['preview.js', 'text/javascript; charset=utf-8'],
};

async function main() {
  const server = http.createServer((request, response) => {
    const file = files[request.url];
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', file[1]);
    fs.createReadStream(path.join(preview, file[0])).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const pageErrors = [];
    const externalRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      if (!request.url().startsWith(url)) externalRequests.push(request.url());
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByText('npub1syntheticpreviewonly').waitFor();
    assert.equal(await page.locator('.fips-panel dl dd').first().innerText(), 'running');
    if (process.env.FIPS_BROWSER_SHOTS === '1') {
      await page.screenshot({ path: path.join(preview, 'online.png'), fullPage: true });
    }

    await page.evaluate(() => window.previewMode('offline'));
    await page.waitForFunction(() => document.querySelector('.fips-panel dl dd')?.textContent?.trim() === 'offline');
    if (process.env.FIPS_BROWSER_SHOTS === '1') {
      await page.screenshot({ path: path.join(preview, 'offline.png'), fullPage: true });
    }
    await page.evaluate(() => window.previewMode('error'));
    await page.getByText('Router request failed (503).').waitFor();
    assert.equal(await page.locator('.fips-panel form').count(), 0);
    if (process.env.FIPS_BROWSER_SHOTS === '1') {
      await page.screenshot({ path: path.join(preview, 'error.png'), fullPage: true });
    }

    await page.evaluate(() => window.previewMode('online'));
    await page.waitForFunction(() => document.querySelector('.fips-panel dl dd')?.textContent?.trim() === 'running');
    const udpPort = page.getByRole('spinbutton', { name: 'UDP port', exact: true });
    await udpPort.fill('2122');
    await page.getByRole('button', { name: 'Validate and stage' }).click();
    await page.getByText('Configuration staged. Apply it when you are ready to check connectivity.').waitFor();
    await page.getByRole('button', { name: 'Apply staged changes' }).click();
    await page.getByRole('heading', { name: 'Change awaiting confirmation' }).waitFor();
    await page.getByRole('button', { name: 'Keep changes' }).click();
    await page.getByText('Change confirmed.').waitFor();
    assert.equal(await udpPort.inputValue(), '2122');

    await udpPort.fill('2123');
    await page.getByRole('button', { name: 'Validate and stage' }).click();
    await page.getByRole('button', { name: 'Apply staged changes' }).click();
    await page.getByRole('heading', { name: 'Change awaiting confirmation' }).waitFor();
    await page.getByRole('button', { name: 'Roll back now' }).click();
    await page.getByText('Previous configuration restored.').waitFor();
    assert.equal(await udpPort.inputValue(), '2122');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.FIPS_BROWSER_SHOTS === '1') {
      await page.screenshot({ path: path.join(preview, 'mobile.png'), fullPage: true });
    }
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(externalRequests, []);
    console.log('Browser preview: online, offline, request error, confirm, rollback, narrow viewport passed');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
