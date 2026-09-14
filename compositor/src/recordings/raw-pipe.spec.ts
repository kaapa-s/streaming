import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  frameSize,
  i420FrameSize,
  parseRawPacket,
  videoFormatByCode,
  videoFormatCode,
  RAW_AUDIO,
  RAW_VIDEO,
} from './raw-pipe';

describe('raw-pipe', () => {
  it('sizes I420 as 1.5 bytes per pixel', () => {
    assert.equal(i420FrameSize(1920, 1080), 1920 * 1080 * 1.5);
  });

  it('sizes frames per pixel format', () => {
    const i420 = videoFormatByCode(videoFormatCode('I420')!)!;
    const nv12 = videoFormatByCode(videoFormatCode('NV12')!)!;
    const rgba = videoFormatByCode(videoFormatCode('RGBA')!)!;
    assert.equal(frameSize(i420, 1920, 1080), 1920 * 1080 * 1.5);
    assert.equal(frameSize(nv12, 1920, 1080), 1920 * 1080 * 1.5);
    assert.equal(frameSize(rgba, 1920, 1080), 1920 * 1080 * 4);
  });

  it('maps WebCodecs formats to ffmpeg pix_fmt', () => {
    assert.equal(videoFormatByCode(videoFormatCode('I420')!)?.pixFmt, 'yuv420p');
    assert.equal(videoFormatByCode(videoFormatCode('NV12')!)?.pixFmt, 'nv12');
    assert.equal(videoFormatByCode(videoFormatCode('BGRA')!)?.pixFmt, 'bgra');
    assert.equal(videoFormatCode('YUV9000'), undefined);
  });

  it('parses a video packet and its pixel format', () => {
    const nv12 = videoFormatCode('NV12')!;
    const packet = parseRawPacket(Buffer.from([RAW_VIDEO, nv12, 1, 2, 3]));
    assert.equal(packet?.kind, 'video');
    assert.deepEqual(packet?.payload, Buffer.from([1, 2, 3]));
    assert.equal(packet?.kind === 'video' && packet.format.name, 'NV12');
    assert.equal(packet?.kind === 'video' && packet.format.pixFmt, 'nv12');
  });

  it('parses an audio packet', () => {
    const audio = parseRawPacket(Buffer.from([RAW_AUDIO, 9]));
    assert.deepEqual(audio, { kind: 'audio', payload: Buffer.from([9]) });
  });

  it('rejects empty, unknown, and bad-format packets', () => {
    assert.equal(parseRawPacket(Buffer.alloc(0)), undefined);
    assert.equal(parseRawPacket(Buffer.from([99, 1])), undefined);
    // Video with an unknown format code must not reach ffmpeg as yuv420p.
    assert.equal(parseRawPacket(Buffer.from([RAW_VIDEO, 200, 1, 2])), undefined);
    assert.equal(parseRawPacket(Buffer.from([RAW_VIDEO, 1])), undefined);
  });
});
