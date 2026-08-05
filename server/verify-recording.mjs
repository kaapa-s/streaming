/**
 * Loads a recorded .webm into headless Chrome and reports duration,
 * resolution and whether audio bytes were decoded; saves a mid-video frame
 * to recordings/verify-frame.png. Usage: node verify-recording.mjs <file>
 *
 * Prefer running from compositor/: node ../server/verify-recording.mjs <file>
 * or pass an absolute path under compositor/recordings/.
 */
import { createRequire } from 'module';
import { readdirSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const puppeteer = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../compositor/node_modules/puppeteer'),
);

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../compositor/recordings');
const file =
  process.argv[2] ??
  path.join(dir, readdirSync(dir).filter((f) => f.endsWith('.webm')).sort().at(-1));

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`file://${file}`);
  const info = await page.evaluate(async () => {
    const video = document.querySelector('video');
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 500));
    if (Number.isFinite(video.duration)) video.currentTime = video.duration / 2;
    await new Promise((r) => setTimeout(r, 1000));
    video.pause();
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      audioDecodedBytes: video.webkitAudioDecodedByteCount,
      videoDecodedFrames: video.webkitDecodedFrameCount,
    };
  });
  console.log(file);
  console.log(info);
  const out = path.join(dir, 'verify-frame.png');
  await page.screenshot({ path: out });
  console.log(`frame saved to ${out}`);
} finally {
  await browser.close();
}
