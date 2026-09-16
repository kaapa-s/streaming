/**
 * Deterministic two-speaker end-to-end smoke test.
 *
 * Prereqs: API, SFU, compositor, and web all running (`npm run dev`).
 * Run: node e2e/two-speaker.mjs
 *
 * The media supplied to the studio is created in each page before the app is
 * loaded. No Chromium fake devices are used: both tracks are Web APIs owned by
 * the harness.
 */
import { createRequire } from 'module';
import { mkdirSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const repoDir = dirname(fileURLToPath(import.meta.url));
const serverDir = join(repoDir, '../server');
const dotenv = require(join(serverDir, 'node_modules/dotenv'));
dotenv.config({ path: join(serverDir, '.env'), quiet: true });
const puppeteer = require(
  join(serverDir, '../compositor/node_modules/puppeteer'),
);

const WEB = process.env.WEB_ORIGIN ?? 'https://localhost:5173';
const API = process.env.API_ORIGIN ?? 'http://localhost:3000/api';
const SIGNUP_PASSWORD = process.env.E2E_SIGNUP_PASSWORD ?? process.env.SIGNUP_PASSWORD;
const TIMEOUT_MS = 30_000;
const RECORDING_MS = 12_000;
const ARTIFACT_ROOT = process.env.E2E_ARTIFACT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'e2e-artifacts');

// These are part of the fixture contract. Keep them stable so recordings from
// different runs can be compared without having to inspect the browser.
const MEDIA_FIXTURES = {
  Alice: { frequencyHz: 440, width: 1280, height: 720, frameRate: 30, color: '#1d4ed8', label: 'ALICE' },
  Bob: { frequencyHz: 660, width: 1280, height: 720, frameRate: 30, color: '#b91c1c', label: 'BOB' },
};

const runId = `${Date.now()}-${process.pid}`;
const room = `e2e-${runId}`;
const artifactDir = join(ARTIFACT_ROOT, runId);
const pages = [];
let browser;

async function register(email, password, name) {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name, signupPassword: SIGNUP_PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`register failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

async function setDeterministicRecordingLayout(accessToken) {
  const res = await fetch(`${API}/rooms/${encodeURIComponent(room)}/layout`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    // The product default is focus (one featured speaker). The quality gate
    // must exercise both deterministic speakers in the recorded program.
    body: JSON.stringify({ cameraPreset: 'grid', featuredId: null, sceneScreenIds: [] }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`layout setup failed (${res.status}): ${JSON.stringify(body)}`);
}

function mediaFixtureInit() {
  // This function is serialized and evaluated by Chromium before any page
  // script, including React's join effect, can call getUserMedia.
  return (config) => {
    const streams = [];
    const contexts = [];
    const oscillators = [];
    const canvas = document.createElement('canvas');
    canvas.width = config.width;
    canvas.height = config.height;
    const context = canvas.getContext('2d');
    const audioContext = new AudioContext({ sampleRate: 48_000 });
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();
    oscillator.type = 'sine';
    oscillator.frequency.value = config.frequencyHz;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    void audioContext.resume();

    let frame = 0;
    const draw = () => {
      context.fillStyle = config.color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.textAlign = 'center';
      context.font = 'bold 96px monospace';
      context.fillText(config.label, canvas.width / 2, 130);
      context.font = '48px monospace';
      context.fillText(`frame ${String(frame).padStart(6, '0')}`, canvas.width / 2, 205);
      frame += 1;
    };
    draw();
    const timer = setInterval(draw, 1000 / config.frameRate);
    const video = canvas.captureStream(config.frameRate).getVideoTracks()[0];
    const audio = destination.stream.getAudioTracks()[0];
    video.contentHint = 'motion';
    const stream = new MediaStream([audio, video]);
    streams.push(stream);
    contexts.push(audioContext);
    oscillators.push(oscillator);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: async () => stream,
    });
    window.__deterministicMedia = {
      fixture: { ...config },
      calls: 0,
      stream,
      cleanup: async () => {
        clearInterval(timer);
        streams.forEach((item) => item.getTracks().forEach((track) => track.stop()));
        oscillators.forEach((item) => {
          try { item.stop(); } catch { /* already stopped by browser cleanup */ }
        });
        await Promise.all(contexts.map((item) => item.close().catch(() => undefined)));
      },
    };
    const original = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (...args) => {
      window.__deterministicMedia.calls += 1;
      return original(...args);
    };
  };
}

async function waitForSpeaker(page, name) {
  await page.waitForFunction(
    () => location.pathname === '/live',
    { timeout: TIMEOUT_MS },
  );
  await page.waitForFunction(
    () => {
      const media = window.__deterministicMedia;
      const tracks = media?.stream?.getTracks() ?? [];
      return media?.calls === 1 && tracks.length === 2 &&
        tracks.some((track) => track.kind === 'audio' && track.readyState === 'live') &&
        tracks.some((track) => track.kind === 'video' && track.readyState === 'live');
    },
    { timeout: TIMEOUT_MS },
  );
  console.log(`${name}: joined and published audio/video`);
}

async function saveFailureArtifacts(error) {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, 'run.json'), JSON.stringify({ runId, room, error: String(error), fixtures: MEDIA_FIXTURES }, null, 2));
  await Promise.all(pages.map(async (page, index) => {
    const name = page.__speakerName ?? `speaker-${index}`;
    try {
      await page.screenshot({ path: join(artifactDir, `${name}.png`), fullPage: true });
      writeFileSync(join(artifactDir, `${name}.html`), await page.content());
    } catch (artifactError) {
      writeFileSync(join(artifactDir, `${name}.artifact-error.txt`), String(artifactError));
    }
  }));
  console.error(`E2E artifacts: ${artifactDir}`);
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  if (!SIGNUP_PASSWORD) throw new Error('SIGNUP_PASSWORD or E2E_SIGNUP_PASSWORD must be set');
  const password = 'password123';
  const unique = `${runId}`;
  const [alice, bob] = await Promise.all([
    register(`alice-${unique}@example.com`, password, 'Alice'),
    register(`bob-${unique}@example.com`, password, 'Bob'),
  ]);

  browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--ignore-certificate-errors',
    ],
  });

  for (const [name, session] of [['Alice', alice], ['Bob', bob]]) {
    const page = await browser.newPage();
    page.__speakerName = name;
    pages.push(page);
    page.on('pageerror', (error) => console.error(`[${name}] pageerror:`, String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[${name}] console.error:`, message.text());
    });
    await page.evaluateOnNewDocument(mediaFixtureInit(), MEDIA_FIXTURES[name]);
    await page.goto(`${WEB}/?room=${room}&auto=1`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await page.evaluate((sess) => {
      localStorage.setItem('streaming-access-token', sess.accessToken);
      localStorage.setItem('streaming-refresh-token', sess.refreshToken);
      localStorage.setItem('streaming-user', JSON.stringify(sess.user));
    }, session);
    await page.goto(`${WEB}/?room=${room}&auto=1`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await waitForSpeaker(page, name);
  }

  await setDeterministicRecordingLayout(alice.accessToken);

  const start = await fetch(`${API}/recordings/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.accessToken}` },
    body: JSON.stringify({ room }),
  });
  console.log('start:', start.status, await start.text());
  if (!start.ok) throw new Error(`recording start failed: ${start.status}`);
  await new Promise((resolve) => setTimeout(resolve, RECORDING_MS));

  const stop = await fetch(`${API}/recordings/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.accessToken}` },
    body: JSON.stringify({ room }),
  });
  const body = await stop.json();
  console.log('stop:', stop.status, body);
  if (!stop.ok || !body.file) throw new Error(`recording stop failed: ${JSON.stringify(body)}`);
  const size = statSync(body.file).size;
  console.log(`recording: ${body.file} (${(size / 1024).toFixed(0)} KiB)`);
  if (size < 200_000) throw new Error('recording suspiciously small');
  console.log('E2E OK');
}

try {
  await main();
} catch (error) {
  console.error('E2E FAIL:', error);
  await saveFailureArtifacts(error);
  process.exitCode = 1;
} finally {
  await Promise.all(pages.map(async (page) => {
    try { await page.evaluate(() => window.__deterministicMedia?.cleanup?.()); } catch { /* page may have crashed */ }
    try { await page.close(); } catch { /* already closed */ }
  }));
  if (browser) await browser.close();
}
