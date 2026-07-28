/**
 * Loads a recorded .webm into headless Chrome and reports duration,
 * resolution and whether audio bytes were decoded; saves a mid-video frame
 * to recordings/verify-frame.png. Usage: node verify-recording.mjs <file>
 */
import { readdirSync } from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';

const dir = path.resolve('recordings');
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
    // seek to the middle so the screenshot shows real content
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
  await page.screenshot({ path: 'recordings/verify-frame.png' });
  console.log('frame saved to recordings/verify-frame.png');
} finally {
  await browser.close();
}
