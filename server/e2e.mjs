/**
 * End-to-end smoke test:
 *  - two headless "speakers" with fake camera/mic join the studio,
 *  - a recording is started and stopped through the API,
 *  - the resulting .webm must exist and be reasonably sized.
 *
 * Prereqs: server (npm run dev) and web (npm run dev) both running.
 * Run: node e2e.mjs
 */
import { statSync } from 'fs';
import puppeteer from 'puppeteer';

const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
const API = 'http://localhost:3000/api';
const room = `e2e-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  for (const name of ['Alice', 'Bob']) {
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.error(`[${name}] pageerror:`, String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error(`[${name}] console.error:`, msg.text());
    });
    await page.goto(`${WEB}/?room=${room}&name=${name}&auto=1`);
  }

  // let both speakers join and publish
  await sleep(5000);

  let res = await fetch(`${API}/recordings/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room }),
  });
  console.log('start:', res.status, await res.text());
  if (res.status >= 400) process.exit(1);

  await sleep(12000);

  res = await fetch(`${API}/recordings/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room }),
  });
  const body = await res.json();
  console.log('stop:', res.status, body);
  if (res.status >= 400 || !body.file) process.exit(1);

  await sleep(500);
  const size = statSync(body.file).size;
  console.log(`recording: ${body.file} (${(size / 1024).toFixed(0)} KiB)`);
  if (size < 200_000) {
    console.error('E2E FAIL: recording suspiciously small');
    process.exit(1);
  }
  console.log('E2E OK');
} finally {
  await browser.close();
}
