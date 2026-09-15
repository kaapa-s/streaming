#!/usr/bin/env node
/**
 * Restart a stuck recording session.
 *
 * `POST /api/recordings/start` returns 400 `already recording room "<slug>"` when
 * either the API's in-memory `activeIds` map or the compositor's session map still
 * holds the room — typically after a crash/redeploy where `stop` never ran.
 *
 * `POST /api/recordings/stop` clears both: it calls the compositor first and only
 * then throws 404 if the API map was already empty, so a 404 here still means the
 * compositor was released. This script stops, waits, and starts again.
 *
 * Usage:
 *   node scripts/restart-recording.mjs
 *   node scripts/restart-recording.mjs --room=main --dest=youtube:STREAM_KEY
 *   node scripts/restart-recording.mjs --status      # just show compositor state
 *   node scripts/restart-recording.mjs --stop-only   # clear without restarting
 *
 * Credentials: STREAMING_EMAIL / STREAMING_PASSWORD, or STREAMING_TOKEN for an
 * existing access token. Prompts interactively when unset.
 */
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const args = new Map();
const flags = new Set();
for (const raw of process.argv.slice(2)) {
  const m = raw.match(/^--([^=]+)=(.*)$/);
  if (m) {
    if (m[1] === 'dest') args.set('dest', [...(args.get('dest') ?? []), m[2]]);
    else args.set(m[1], m[2]);
  } else if (raw.startsWith('--')) {
    flags.add(raw.slice(2));
  }
}

const API = (args.get('api') ?? process.env.STREAMING_API_URL ?? 'https://streaming.kaapa.pl').replace(/\/$/, '');
// No default room: slugs are random per stream now, so a fallback would only
// ever act on the wrong room.
const ROOM = args.get('room') ?? process.env.STREAMING_ROOM;
if (!ROOM) {
  console.error('usage: restart-recording.mjs --room=<slug> [--api=<url>] [--resolution=...]');
  console.error('       (or set STREAMING_ROOM). Find live slugs via GET /api/recordings.');
  process.exit(1);
}
const RESOLUTION = args.get('resolution');
const WAIT_MS = Number(args.get('wait') ?? 3000);

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    if (hidden) {
      // Suppress echo of typed characters.
      rl._writeToOutput = (s) => {
        if (s.includes(question)) stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

/** fetch + JSON, returning { ok, status, body } instead of throwing on HTTP errors. */
async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

function describe(payload) {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const msg = payload.message;
    return Array.isArray(msg) ? msg.join('; ') : String(msg);
  }
  return JSON.stringify(payload);
}

async function login() {
  const preset = args.get('token') ?? process.env.STREAMING_TOKEN;
  if (preset) {
    log('→ using STREAMING_TOKEN');
    return preset;
  }
  const email = args.get('email') ?? process.env.STREAMING_EMAIL ?? (await prompt('email: '));
  const password = process.env.STREAMING_PASSWORD ?? (await prompt('password: ', { hidden: true }));
  if (!email || !password) {
    throw new Error('email and password are required (set STREAMING_EMAIL / STREAMING_PASSWORD)');
  }
  const res = await api('POST', '/auth/login', { body: { email, password } });
  if (!res.ok) throw new Error(`login failed (${res.status}): ${describe(res.body)}`);
  log(`→ logged in as ${res.body.user?.email ?? email}`);
  return res.body.accessToken;
}

/** Destinations: --dest=youtube:KEY (repeatable). Empty = record only, no RTMP. */
function destinations() {
  const raw = args.get('dest') ?? [];
  return raw.map((entry) => {
    const idx = entry.indexOf(':');
    if (idx < 1) throw new Error(`bad --dest "${entry}" — expected platform:streamKey`);
    return { platform: entry.slice(0, idx).trim(), streamKey: entry.slice(idx + 1).trim() };
  });
}

async function showStatus(token) {
  const res = await api('GET', '/recordings', { token });
  log(`→ status (${res.status}): ${JSON.stringify(res.body)}`);
  return res;
}

async function stop(token) {
  const res = await api('POST', '/recordings/stop', { token, body: { room: ROOM } });
  if (res.ok) {
    log(`→ stopped: file=${res.body.file ?? 'none'} s3=${res.body.s3Key ?? 'none'}`);
    return true;
  }
  if (res.status === 404) {
    // API map was already empty; compositor.stop still ran, so the room is released.
    log(`→ no active recording tracked by the API — compositor released anyway`);
    return true;
  }
  warn(`→ stop failed (${res.status}): ${describe(res.body)}`);
  return false;
}

async function start(token) {
  const dests = destinations();
  const body = { room: ROOM };
  if (dests.length) body.destinations = dests;
  if (RESOLUTION) body.resolution = RESOLUTION;
  const res = await api('POST', '/recordings/start', { token, body });
  if (res.ok) {
    log(
      `→ started room=${res.body.room} live=${res.body.live} ` +
        `resolution=${res.body.resolution} destinations=${(res.body.destinations ?? []).join(',') || 'none'}`,
    );
    return true;
  }
  warn(`→ start failed (${res.status}): ${describe(res.body)}`);
  return false;
}

async function main() {
  const token = await login();

  if (flags.has('status')) {
    await showStatus(token);
    process.exit(0);
  }

  log(`\n── restarting recording: room="${ROOM}" at ${API} ──`);
  await showStatus(token);

  log('\n[1/3] stopping current session…');
  await stop(token);

  if (flags.has('stop-only')) {
    log('\n--stop-only: done. The room is clear; start recording from the studio when ready.');
    process.exit(0);
  }

  log(`\n[2/3] waiting ${WAIT_MS}ms for the compositor to release the room…`);
  await sleep(WAIT_MS);

  log('\n[3/3] starting a new session…');
  let started = await start(token);

  if (!started) {
    // One retry: a slow compositor teardown can still report the room as busy.
    warn('\nretrying once after a second stop + longer wait…');
    await stop(token);
    await sleep(Math.max(WAIT_MS, 5000));
    started = await start(token);
  }

  if (!started) {
    warn(
      '\nStill stuck. The compositor session likely outlived the API process.\n' +
        'On the compositor box, check the session map and restart the container:\n' +
        '  docker compose restart compositor\n' +
        'Then re-run this script.',
    );
    process.exit(1);
  }

  log('\n✔ recording restarted');
  await showStatus(token);
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  if (err?.cause) console.error(`  cause: ${err.cause.message ?? err.cause}`);
  process.exit(1);
});
