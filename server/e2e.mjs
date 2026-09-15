/**
 * End-to-end smoke test:
 *  - register/login via API,
 *  - Alice creates a room and both headless "speakers" join it by its invite link,
 *  - a recording is started and stopped through the API (owner-only),
 *  - the resulting .webm must exist and be reasonably sized,
 *  - the room is ended, which frees the compositor slot.
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

// Alice owns the room; Bob joins it by link, exactly like a real invitee.
const createRes = await fetch(`${API}/rooms`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${alice.accessToken}`,
  },
  body: JSON.stringify({ title: `e2e ${new Date().toISOString()}` }),
});
const created = await createRes.json();
if (!createRes.ok) throw new Error(`create room failed: ${JSON.stringify(created)}`);
const room = created.slug;
console.log(`room: ${room} ("${created.title}")`);

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
    const roomUrl = `${WEB}/r/${room}?auto=1`;
    await page.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate((sess) => {
      localStorage.setItem('streaming-access-token', sess.accessToken);
      localStorage.setItem('streaming-refresh-token', sess.refreshToken);
      localStorage.setItem('streaming-user', JSON.stringify(sess.user));
    }, session);
    await page.goto(roomUrl, { waitUntil: 'domcontentloaded' });
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

  // End the room: closes it, releases the compositor slot, kills the link.
  res = await fetch(`${API}/rooms/${room}/end`, {
    method: 'POST',
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  console.log('end:', res.status, await res.text());
  if (res.status >= 400) process.exit(1);

  // Bob must no longer be able to join a closed room.
  res = await fetch(`${API}/rooms/${room}/join`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  if (res.status !== 410) {
    console.error(`E2E FAIL: join on a closed room returned ${res.status}, expected 410`);
    process.exit(1);
  }

  console.log('E2E OK');
} finally {
  await browser.close();
}
