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
import { spawn } from 'child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { validateRecording } from './recording-validation.mjs';
import { startLocalRtmpReceiver } from './local-rtmp-receiver.mjs';

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
const PHASE_DURATION_MS = 5_000;
const PHASE_LEAD_MS = 1_000;
// Three 5s phases plus a 1s lead-in and 1s encoder/stop margin.
const RECORDING_MS = PHASE_LEAD_MS + PHASE_DURATION_MS * 3 + 1_000;
const SCENE_INTERVAL_MS = 3_000;
const PHASES = [
  { name: 'BOB SOLO', displayName: 'BOTH ON SCREEN — BOB AUDIO', active: ['Bob'] },
  { name: 'ALICE SOLO', displayName: 'BOTH ON SCREEN — ALICE AUDIO', active: ['Alice'] },
  { name: 'BOB + ALICE', displayName: 'BOTH ON SCREEN — BOTH AUDIO', active: ['Bob', 'Alice'] },
];
const DIAGNOSTIC_TIMEOUT_MS = 20_000;
const AUDIO_METRIC = {
  rmsMinimum: 0.002,
  expectedEnergyMinimum: 0.18,
  selfLeakageMaximum: 0.08,
  frequencyToleranceHz: 35,
};
const ARTIFACT_ROOT = process.env.E2E_ARTIFACT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'e2e-artifacts');

// These are part of the fixture contract. Keep them stable so recordings from
// different runs can be compared without having to inspect the browser.
const MEDIA_FIXTURES = {
  Alice: { frequencyHz: 440, width: 1280, height: 720, frameRate: 30, color: '#1d4ed8', label: 'ALICE' },
  Bob: { frequencyHz: 660, width: 1280, height: 720, frameRate: 30, color: '#b91c1c', label: 'BOB' },
};

const runId = process.env.E2E_RUN_ID ?? `${Date.now()}-${process.pid}`;
const room = `e2e-${runId}`;
const artifactDir = join(ARTIFACT_ROOT, runId);
const pages = [];
let browser;
let cleanupAccessToken;
let recordingFile;
let rtmpReceiver;

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

async function createRoom(accessToken) {
  const res = await fetch(`${API}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name: room, slug: room }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`room creation failed (${res.status}): ${JSON.stringify(body)}`);
  console.log(`room created: ${body.slug}`);
  return body;
}

async function inviteParticipant(accessToken, participantToken, displayName) {
  const inviteRes = await fetch(`${API}/rooms/${encodeURIComponent(room)}/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const invite = await inviteRes.json();
  if (!inviteRes.ok) throw new Error(`room invite failed (${inviteRes.status}): ${JSON.stringify(invite)}`);
  const admitRes = await fetch(`${API}/rooms/invite/admit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${participantToken}` },
    body: JSON.stringify({ token: invite.token, displayName }),
  });
  const admission = await admitRes.json();
  if (!admitRes.ok) throw new Error(`room invite admission failed (${admitRes.status}): ${JSON.stringify(admission)}`);
  console.log(`room participant admitted: ${displayName}`);
}

async function setDeterministicLayout(accessToken, layout) {
  const res = await fetch(`${API}/rooms/${encodeURIComponent(room)}/layout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(layout),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`layout ${layout.cameraPreset} failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

function mediaFixtureInit() {
  // This function is serialized and evaluated by Chromium before any page
  // script, including React's join effect, can call getUserMedia.
  return (config) => {
    const streams = [];
    const contexts = [];
    const oscillators = [];
    const screenStreams = [];
    const screenTimers = [];
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
    gain.gain.value = 0;
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    void audioContext.resume();

    let frame = 0;
    let phaseStartAt = 0;
    const phaseFor = (now) => {
      const index = phaseStartAt > 0 ? Math.floor((now - phaseStartAt) / config.phaseDurationMs) : -1;
      return config.phases[Math.max(-1, Math.min(config.phases.length - 1, index))];
    };
    const draw = () => {
      const phase = phaseFor(Date.now());
      // Keep the deterministic tone live for pre-recording remote-audio
      // assertions. startPhases() switches both gain and visual cue into the
      // staged recording schedule before the recorder is allowed to run.
      const active = phase ? phase.active.includes(config.label === 'BOB' ? 'Bob' : 'Alice') : true;
      gain.gain.value = active ? 0.08 : 0;
      context.fillStyle = config.color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.textAlign = 'center';
      context.font = 'bold 96px monospace';
      context.fillText(config.label, canvas.width / 2, 130);
      context.font = 'bold 52px monospace';
      const displayCue = phase?.displayName ?? 'WAITING FOR RECORDING';
      const [cueLine, cueDetail] = displayCue.split(' — ');
      context.fillText(cueLine, canvas.width / 2, 285);
      if (cueDetail) context.fillText(cueDetail, canvas.width / 2, 350);
      context.font = '48px monospace';
      context.fillText(`frame ${String(frame).padStart(6, '0')}`, canvas.width / 2, 420);
      frame += 1;
    };
    draw();
    const timer = setInterval(draw, 1000 / config.frameRate);
    const video = canvas.captureStream(config.frameRate).getVideoTracks()[0];
    const audio = destination.stream.getAudioTracks()[0];
    video.contentHint = 'motion';
    const stream = new MediaStream([audio, video]);
    streams.push(stream);
    let screenStream;
    if (config.screenEnabled) {
      const screenCanvas = document.createElement('canvas');
      screenCanvas.width = 1920;
      screenCanvas.height = 1080;
      const screenContext = screenCanvas.getContext('2d');
      let screenFrame = 0;
      const drawScreen = () => {
        screenContext.fillStyle = '#047857';
        screenContext.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
        screenContext.fillStyle = '#ffffff';
        screenContext.textAlign = 'center';
        screenContext.font = 'bold 92px monospace';
        screenContext.fillText('DETERMINISTIC SCREEN', screenCanvas.width / 2, 220);
        screenContext.font = 'bold 64px monospace';
        screenContext.fillText(`frame ${String(screenFrame++).padStart(6, '0')}`, screenCanvas.width / 2, 420);
      };
      drawScreen();
      const screenTimer = setInterval(drawScreen, 1000 / config.frameRate);
      screenTimers.push(screenTimer);
      screenStream = screenCanvas.captureStream(config.frameRate);
      screenStreams.push(screenStream);
      const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
      navigator.mediaDevices.getDisplayMedia = async () => screenStream;
      void originalGetDisplayMedia;
    }
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
      screenStream,
      getFrameStats: () => ({
        counterScope: 'source-canvas-draws',
        counterValue: frame,
        configuredCadenceFps: config.frameRate,
      }),
      phases: config.phases,
      startPhases: (startAt) => { phaseStartAt = Number(startAt); draw(); },
      cleanup: async () => {
        clearInterval(timer);
        screenTimers.forEach((item) => clearInterval(item));
        streams.forEach((item) => item.getTracks().forEach((track) => track.stop()));
        screenStreams.forEach((item) => item.getTracks().forEach((track) => track.stop()));
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

async function measureRemoteAudio(page) {
  return page.evaluate(async ({ expectedName, expectedHz, ownHz }) => {
    const diagnostics = window.__studioDiagnostics;
    if (!diagnostics) throw new Error('studio diagnostics are not enabled');
    const peers = diagnostics.peers;
    const context = new AudioContext({ sampleRate: 48_000 });
    await context.resume();
    const results = [];
    try {
      for (const peer of peers) {
        const tracks = peer.stream.getTracks();
        const audioTracks = peer.stream.getAudioTracks().filter((track) => track.readyState !== 'ended');
        if (audioTracks.length === 0) {
          results.push({
            id: peer.id,
            name: peer.name,
            trackKinds: tracks.map((track) => track.kind),
            audioTrackCount: 0,
            videoTrackCount: peer.stream.getVideoTracks().filter((track) => track.readyState !== 'ended').length,
            rms: 0,
            dominantHz: 0,
            expectedEnergyRatio: 0,
            selfEnergyRatio: 0,
          });
          continue;
        }
        const source = context.createMediaStreamSource(new MediaStream(audioTracks));
        const analyser = context.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);
        const time = new Float32Array(analyser.fftSize);
        const bins = new Float32Array(analyser.frequencyBinCount);
        const samples = [];
        for (let sample = 0; sample < 12; sample += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          analyser.getFloatTimeDomainData(time);
          analyser.getFloatFrequencyData(bins);
          let sum = 0;
          for (const value of time) sum += value * value;
          const binHz = context.sampleRate / analyser.fftSize;
          const energyAt = (frequency) => {
            let energy = 0;
            for (let i = 0; i < bins.length; i += 1) {
              if (Math.abs(i * binHz - frequency) <= 35) {
                energy += 10 ** (bins[i] / 10);
              }
            }
            return energy;
          };
          let peakBin = 0;
          for (let i = 1; i < bins.length; i += 1) {
            if (bins[i] > bins[peakBin]) peakBin = i;
          }
          const expectedEnergy = energyAt(expectedHz);
          const ownEnergy = energyAt(ownHz);
          const totalEnergy = bins.reduce((sumEnergy, value) => sumEnergy + 10 ** (value / 10), 0);
          samples.push({
            rms: Math.sqrt(sum / time.length),
            dominantHz: peakBin * binHz,
            expectedEnergyRatio: totalEnergy > 0 ? expectedEnergy / totalEnergy : 0,
            selfEnergyRatio: totalEnergy > 0 ? ownEnergy / totalEnergy : 0,
          });
        }
        source.disconnect();
        const average = (key) => samples.reduce((sum, item) => sum + item[key], 0) / samples.length;
        results.push({
          id: peer.id,
          name: peer.name,
          trackKinds: tracks.map((track) => track.kind),
          audioTrackCount: audioTracks.length,
          videoTrackCount: peer.stream.getVideoTracks().filter((track) => track.readyState !== 'ended').length,
          rms: average('rms'),
          dominantHz: average('dominantHz'),
          expectedEnergyRatio: average('expectedEnergyRatio'),
          selfEnergyRatio: average('selfEnergyRatio'),
        });
      }
    } finally {
      await context.close();
    }
    return { expectedName, peers: results };
  }, {
    expectedName: page.__speakerName === 'Alice' ? 'Bob' : 'Alice',
    expectedHz: page.__speakerName === 'Alice' ? MEDIA_FIXTURES.Bob.frequencyHz : MEDIA_FIXTURES.Alice.frequencyHz,
    ownHz: page.__speakerName === 'Alice' ? MEDIA_FIXTURES.Alice.frequencyHz : MEDIA_FIXTURES.Bob.frequencyHz,
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr: Buffer.concat(stderr).toString() }));
  });
}

async function captureLayoutFrames(file, artifactDir, duration) {
  const layouts = [
    { name: 'focus', timestampSeconds: 1.5 },
    { name: 'pip-left', timestampSeconds: 4.5 },
    { name: 'pip-right', timestampSeconds: 7.5 },
    { name: 'grid-side-by-side', timestampSeconds: 10.5 },
    { name: 'presentation', timestampSeconds: 13.5 },
  ];
  const frames = [];
  for (const layout of layouts) {
    if (layout.timestampSeconds >= duration - 0.1) continue;
    const filePath = join(artifactDir, `layout-${layout.name}.png`);
    const result = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', [
      '-v', 'error', '-ss', String(layout.timestampSeconds), '-i', file,
      '-frames:v', '1', '-f', 'image2', filePath,
    ]);
    if (result.code !== 0) throw new Error(`layout frame could not be extracted (${layout.name}): ${result.stderr}`);
    frames.push({ ...layout, file: filePath });
  }
  writeFileSync(join(artifactDir, 'layout-frames.json'), JSON.stringify({
    schemaVersion: 'quality-gate/layout-frames-v1',
    meaning: 'Human-facing diagnostic frames captured during the scheduled compositor layouts; not a pixel-perfect pass/fail oracle.',
    frames,
  }, null, 2));
  return frames;
}

function validateSceneSnapshots(file, expectedPresets, expectedSources, sceneAudioContract) {
  const sessionLog = file.replace(/\.[^.]+$/, '.session.log');
  const lines = readFileSync(sessionLog, 'utf8').split(/\r?\n/);
  const snapshots = lines.filter((line) => line.includes(' scene ')).map((line) => {
    const marker = line.indexOf(' scene ');
    return JSON.parse(line.slice(marker + 7));
  });
  const seen = new Set(snapshots.map((snapshot) => snapshot.cameraPreset));
  for (const preset of expectedPresets) {
    if (!seen.has(preset)) throw new Error(`scene snapshot missing preset=${preset}; snapshots=${JSON.stringify(snapshots)}`);
  }
  for (const snapshot of snapshots) {
    for (const source of expectedSources) {
      if (!snapshot.sources.includes(source)) throw new Error(`scene ${snapshot.cameraPreset} removed active source=${source}; snapshot=${JSON.stringify(snapshot)}`);
    }
    if (snapshot.sources.some((source) => typeof source !== 'string' || !source.includes(':'))) {
      throw new Error(`scene ${snapshot.cameraPreset} has invalid source ids; snapshot=${JSON.stringify(snapshot)}`);
    }
    if (snapshot.cameraPreset === 'focus' || snapshot.cameraPreset === 'pip-left' || snapshot.cameraPreset === 'pip-right' || snapshot.cameraPreset === 'grid') {
      if (snapshot.effective !== snapshot.cameraPreset && snapshot.sceneScreenIds.length === 0) {
        throw new Error(`scene ${snapshot.cameraPreset} has unexpected effective preset=${snapshot.effective}; snapshot=${JSON.stringify(snapshot)}`);
      }
    }
  }
  if (!snapshots.some((snapshot) => snapshot.effective === 'presentation' && snapshot.sceneScreenIds.length > 0)) {
    throw new Error(`presentation scene snapshot missing; snapshots=${JSON.stringify(snapshots)}`);
  }
  const firstRecordedScene = snapshots[0];
  const expectedFeaturedId = sceneAudioContract.expectedFeaturedId;
  const expectedAudioSourceIds = [...sceneAudioContract.expectedAudioSourceIds].sort();
  const actualAudioSourceIds = [...(firstRecordedScene?.audioSourceIds ?? [])].sort();
  if (
    !firstRecordedScene ||
    firstRecordedScene.featuredId !== expectedFeaturedId ||
    JSON.stringify(actualAudioSourceIds) !== JSON.stringify(expectedAudioSourceIds)
  ) {
    throw new Error(
      `scene/audio contract failed: first active speaker=${sceneAudioContract.firstActiveSpeaker} ` +
      `expected featuredId=${expectedFeaturedId} actual=${firstRecordedScene?.featuredId ?? 'none'} ` +
      `expected audio=${JSON.stringify(expectedAudioSourceIds)} actual audio=${JSON.stringify(actualAudioSourceIds)}; ` +
      `snapshots=${JSON.stringify(snapshots)}`,
    );
  }
  return {
    snapshots,
    sessionLog,
    sceneAudioContract: {
      firstActiveSpeaker: sceneAudioContract.firstActiveSpeaker,
      expectedFeaturedId,
      firstRecordedSceneFeaturedId: firstRecordedScene.featuredId,
      expectedAudioSourceIds,
      firstRecordedSceneAudioSourceIds: actualAudioSourceIds,
      matched: true,
    },
  };
}

async function assertRemoteAudio(page) {
  await page.waitForFunction(
    () => window.__studioDiagnostics?.peers?.length === 1,
    { timeout: DIAGNOSTIC_TIMEOUT_MS },
  );
  const measured = await measureRemoteAudio(page);
  if (measured.peers.length !== 1) throw new Error(`${page.__speakerName}: expected exactly one remote peer: ${JSON.stringify(measured)}`);
  const [peer] = measured.peers;
  const expectedHz = MEDIA_FIXTURES[measured.expectedName].frequencyHz;
  const ownHz = MEDIA_FIXTURES[page.__speakerName].frequencyHz;
  const failures = [];
  if (peer.name !== measured.expectedName) failures.push(`identity=${peer.name} expected=${measured.expectedName}`);
  if (peer.audioTrackCount !== 1 || peer.videoTrackCount !== 1) failures.push(`tracks audio=${peer.audioTrackCount} video=${peer.videoTrackCount}`);
  if (peer.rms < AUDIO_METRIC.rmsMinimum) failures.push(`silent rms=${peer.rms.toFixed(5)}`);
  if (Math.abs(peer.dominantHz - expectedHz) > AUDIO_METRIC.frequencyToleranceHz) failures.push(`frequency=${peer.dominantHz.toFixed(1)}Hz expected=${expectedHz}Hz`);
  if (peer.expectedEnergyRatio < AUDIO_METRIC.expectedEnergyMinimum) failures.push(`expected-energy=${peer.expectedEnergyRatio.toFixed(3)}`);
  if (peer.selfEnergyRatio > AUDIO_METRIC.selfLeakageMaximum) failures.push(`self-leakage=${peer.selfEnergyRatio.toFixed(3)} own=${ownHz}Hz`);
  console.log(`${page.__speakerName} remote audio:`, JSON.stringify({ ...peer, expectedHz, ownHz, tolerances: AUDIO_METRIC }));
  if (failures.length > 0) throw new Error(`${page.__speakerName}: remote audio contract failed: ${failures.join(', ')}`);
}

async function saveFailureArtifacts(error) {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, 'run.json'), JSON.stringify({
    runId,
    room,
    error: String(error),
    fixtures: MEDIA_FIXTURES,
    phaseSchedule: { phases: PHASES, phaseDurationMs: PHASE_DURATION_MS, leadMs: PHASE_LEAD_MS },
  }, null, 2));
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
  // The quality gate opts into a local receiver; normal smoke runs retain the
  // existing recording-only behavior.
  if (process.env.QUALITY_GATE_LOCAL_RTMP === '1') {
    rtmpReceiver = await startLocalRtmpReceiver(artifactDir);
    console.log(`local RTMP receiver: ${rtmpReceiver.url}`);
  }
  if (!SIGNUP_PASSWORD) throw new Error('SIGNUP_PASSWORD or E2E_SIGNUP_PASSWORD must be set');
  const password = 'password123';
  const unique = `${runId}`;
  const [alice, bob] = await Promise.all([
    register(`alice-${unique}@example.com`, password, 'Alice'),
    register(`bob-${unique}@example.com`, password, 'Bob'),
  ]);
  cleanupAccessToken = alice.accessToken;
  await createRoom(alice.accessToken);
  await inviteParticipant(alice.accessToken, bob.accessToken, 'Bob');

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
    await page.evaluateOnNewDocument(mediaFixtureInit(), {
      ...MEDIA_FIXTURES[name],
      phases: PHASES,
      phaseDurationMs: PHASE_DURATION_MS,
      screenEnabled: name === 'Alice',
    });
    await page.goto(`${WEB}/?room=${room}&auto=1&e2eDiagnostics=1`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await page.evaluate((sess) => {
      localStorage.setItem('streaming-access-token', sess.accessToken);
      localStorage.setItem('streaming-refresh-token', sess.refreshToken);
      localStorage.setItem('streaming-user', JSON.stringify(sess.user));
    }, session);
    await page.goto(
      name === 'Alice' ? `${WEB}/?room=${room}&auto=1&e2eDiagnostics=1` : `${WEB}/join?room=${room.toLowerCase()}&auto=1&e2eDiagnostics=1`,
      { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS },
    );
    // The accepted room-entry flow is automatic: the owner selects the room
    // from the sidebar, while the invited participant enters the canonical
    // room route directly. Neither path relies on the removed Open room UI.
    if (name === 'Alice') {
      await page.waitForFunction(
        (slug) => [...document.querySelectorAll('a')].some((link) => link.getAttribute('href')?.includes(`/join?room=${encodeURIComponent(slug.toLowerCase())}`)),
        { timeout: TIMEOUT_MS },
        room,
      );
      await page.evaluate((slug) => {
        const link = [...document.querySelectorAll('a')].find((candidate) => candidate.getAttribute('href')?.includes(`/join?room=${encodeURIComponent(slug.toLowerCase())}`));
        if (!link) throw new Error('deterministic sidebar room link unavailable');
        link.click();
      }, room);
    }
    await waitForSpeaker(page, name);
  }

  await Promise.all(pages.map((page) => assertRemoteAudio(page)));

  const alicePeerId = await pages[1].evaluate(() => window.__studioDiagnostics?.peers?.find((peer) => peer.name === 'Alice')?.id);
  if (!alicePeerId) throw new Error('Alice peer id unavailable from Bob diagnostics');
  const clickedScreenShare = await pages[0].evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Share screen'));
    if (!button) return false;
    button.click();
    return true;
  });
  if (!clickedScreenShare) throw new Error('deterministic screen-share button unavailable');
  await pages[1].waitForFunction(() => {
    const peer = window.__studioDiagnostics?.peers?.find((candidate) => candidate.name === 'Alice');
    return !!peer?.screenStream?.getVideoTracks()?.some((track) => track.readyState === 'live');
  }, { timeout: TIMEOUT_MS });
  const bobPeerId = await pages[0].evaluate(() => window.__studioDiagnostics?.peers?.find((peer) => peer.name === 'Bob')?.id);
  if (!bobPeerId) throw new Error('Bob peer id unavailable from Alice diagnostics');
  const expectedSources = [`${alicePeerId}:camera`, `${bobPeerId}:camera`];
  const screenSource = `${alicePeerId}:screen`;
  const firstActiveSpeaker = PHASES[0].active[0];
  const firstActiveSource = firstActiveSpeaker === 'Alice' ? alicePeerId : bobPeerId;
  await setDeterministicLayout(alice.accessToken, { cameraPreset: 'focus', featuredId: `${firstActiveSource}:camera`, sceneScreenIds: [] });

  const start = await fetch(`${API}/recordings/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.accessToken}` },
    body: JSON.stringify({
      room,
      ...(rtmpReceiver ? { localRtmpUrl: rtmpReceiver.url } : {}),
    }),
  });
  console.log('start:', start.status, await start.text());
  if (!start.ok) throw new Error(`recording start failed: ${start.status}`);
  const phaseStartAt = Date.now() + PHASE_LEAD_MS;
  await Promise.all(pages.map((page) => page.evaluate((startAt) => window.__deterministicMedia.startPhases(startAt), phaseStartAt)));
  const sceneTransitions = [
    { cameraPreset: 'focus', featuredId: `${firstActiveSource}:camera`, sceneScreenIds: [] },
    { cameraPreset: 'pip-left', featuredId: `${firstActiveSource}:camera`, sceneScreenIds: [] },
    { cameraPreset: 'pip-right', featuredId: `${firstActiveSource}:camera`, sceneScreenIds: [] },
    { cameraPreset: 'grid', featuredId: null, sceneScreenIds: [] },
    { cameraPreset: 'focus', featuredId: `${firstActiveSource}:camera`, sceneScreenIds: [screenSource] },
  ];
  for (const [index, scene] of sceneTransitions.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, SCENE_INTERVAL_MS));
    await setDeterministicLayout(alice.accessToken, scene);
  }
  await new Promise((resolve) => setTimeout(resolve, RECORDING_MS - (sceneTransitions.length - 1) * SCENE_INTERVAL_MS));

  const stop = await fetch(`${API}/recordings/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.accessToken}` },
    body: JSON.stringify({ room }),
  });
  const body = await stop.json();
  console.log('stop:', stop.status, body);
  if (!stop.ok || !body.file) throw new Error(`recording stop failed: ${JSON.stringify(body)}`);
  recordingFile = body.file;
  console.log(`recording: ${body.file}`);
  const sceneReport = validateSceneSnapshots(
    body.file,
    ['focus', 'pip-left', 'pip-right', 'grid'],
    expectedSources,
    {
      firstActiveSpeaker,
      expectedFeaturedId: `${firstActiveSource}:camera`,
      expectedAudioSourceIds: [`${firstActiveSource}:camera`],
    },
  );
  console.log(
    `scene/audio contract: ${firstActiveSpeaker} -> ${sceneReport.sceneAudioContract.firstRecordedSceneFeaturedId} ` +
    `audio=${JSON.stringify(sceneReport.sceneAudioContract.firstRecordedSceneAudioSourceIds)} matched`,
  );
  writeFileSync(join(artifactDir, 'layout-scenes.json'), JSON.stringify({
    schemaVersion: 'quality-gate/layout-scenes-v1',
    expectedPresets: ['focus', 'pip-left', 'pip-right', 'grid'],
    expectedSources,
    ...sceneReport,
  }, null, 2));
  console.log(`layout snapshots: ${sceneReport.snapshots.length}`);
  const sourceFrames = await Promise.all(pages.map(async (page) => ({
    participant: page.__speakerName,
    ...(await page.evaluate(() => window.__deterministicMedia.getFrameStats())),
  })));
  writeFileSync(join(artifactDir, 'source-frame-counters.json'), JSON.stringify({
    schemaVersion: 'quality-gate/source-frame-counters-v1',
    meaning: 'Canvas draw counters; not encoded frames, timestamps, or VLC decoded frames.',
    participants: sourceFrames,
  }, null, 2));
  console.log('source frame counters:', JSON.stringify(sourceFrames));
  const media = await validateRecording(body.file, artifactDir);
  const layoutFrames = await captureLayoutFrames(body.file, artifactDir, media.summary.durationSeconds);
  console.log(`layout evidence frames: ${layoutFrames.map((frame) => frame.name).join(', ')}`);
  console.log('recording validation:', JSON.stringify(media));
  console.log('RECORDING_VALIDATION_OK');
  if (rtmpReceiver) {
    const rtmpMedia = await rtmpReceiver.validate();
    console.log('rtmp validation:', JSON.stringify(rtmpMedia));
    if (rtmpMedia.summary.video?.codec !== 'h264' || rtmpMedia.summary.audio?.codec !== 'aac') {
      throw new Error('local RTMP output must contain H.264 video and AAC audio');
    }
    if (rtmpMedia.summary.durationSeconds < 3 || rtmpMedia.summary.video.keyframes < 1 || rtmpMedia.summary.video.frames < 30) {
      throw new Error('local RTMP output is incomplete or has no usable keyframe/duration');
    }
    console.log('RTMP_VALIDATION_OK');
  }
  console.log('E2E OK');
}

try {
  await main();
} catch (error) {
  console.error('E2E FAIL:', error);
  await saveFailureArtifacts(error);
  process.exitCode = 1;
} finally {
  if (cleanupAccessToken) {
    try {
      const cleanup = await fetch(`${API}/recordings/stop`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cleanupAccessToken}`,
        },
        body: JSON.stringify({ room }),
      });
      if (cleanup.ok) {
        const cleanupBody = await cleanup.json().catch(() => ({}));
        if (!recordingFile && cleanupBody.file) recordingFile = cleanupBody.file;
      } else if (cleanup.status !== 404) {
        console.error(`E2E cleanup failed (${cleanup.status}): ${await cleanup.text()}`);
      }
    } catch (cleanupError) {
      console.error('E2E cleanup request failed:', cleanupError);
    }
  }
  await Promise.all(pages.map(async (page) => {
    try { await page.evaluate(() => window.__deterministicMedia?.cleanup?.()); } catch { /* page may have crashed */ }
    try { await page.close(); } catch { /* already closed */ }
  }));
  if (browser) await browser.close();
  if (recordingFile) {
    const sessionLog = recordingFile.replace(/\.[^.]+$/, '.session.log');
    try { cpSync(sessionLog, join(artifactDir, 'compositor.session.log')); } catch { /* session log may be absent */ }
    try { rmSync(recordingFile, { force: true }); } catch (cleanupError) { console.error('recording file cleanup failed:', cleanupError); }
    try { rmSync(sessionLog, { force: true }); } catch { /* session log may be absent */ }
  }
  if (rtmpReceiver) {
    try { await rtmpReceiver.stop(); } catch (cleanupError) { console.error('RTMP receiver cleanup failed:', cleanupError); }
  }
}
