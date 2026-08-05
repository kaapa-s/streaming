/**
 * End-to-end smoke test:
 *  - register/login via API,
 *  - two headless "speakers" with fake camera/mic join the studio,
 *  - a recording is started and stopped through the API,
 *  - the resulting .webm must exist and be reasonably sized.
 *
 * Prereqs: API, SFU, compositor, and web all running (`npm run dev`).
 * Run: node e2e.mjs
 */
import { createRequire } from 'module';
import { statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const puppeteer = require(
  join(dirname(fileURLToPath(import.meta.url)), '../compositor/node_modules/puppeteer'),
);

const WEB = process.env.WEB_ORIGIN ?? 'https://localhost:5173';
const API = 'http://localhost:3000/api';
const room = `e2e-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function register(email, password, name) {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`register failed: ${JSON.stringify(body)}`);
  return body;
}

const password = 'password123';
const alice = await register(`alice-${Date.now()}@example.com`, password, 'Alice');
const bob = await register(`bob-${Date.now()}@example.com`, password, 'Bob');

const browser = await puppeteer.launch({
  args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--ignore-certificate-errors',
  ],
});

try {
  for (const [name, session] of [
    ['Alice', alice],
    ['Bob', bob],
  ]) {
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.error(`[${name}] pageerror:`, String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error(`[${name}] console.error:`, msg.text());
    });
    await page.goto(`${WEB}/?room=${room}&auto=1`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((sess) => {
      localStorage.setItem('streaming-access-token', sess.accessToken);
      localStorage.setItem('streaming-refresh-token', sess.refreshToken);
      localStorage.setItem('streaming-user', JSON.stringify(sess.user));
    }, session);
    await page.goto(`${WEB}/?room=${room}&auto=1`, { waitUntil: 'domcontentloaded' });
  }

  // let both speakers join and publish
  await sleep(5000);

  let res = await fetch(`${API}/recordings/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${alice.accessToken}`,
    },
    body: JSON.stringify({ room }),
  });
  console.log('start:', res.status, await res.text());
  if (res.status >= 400) process.exit(1);

  await sleep(12000);

  res = await fetch(`${API}/recordings/stop`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${alice.accessToken}`,
    },
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
