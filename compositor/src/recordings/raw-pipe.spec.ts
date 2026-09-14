import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { i420FrameSize, parseRawPacket, RAW_AUDIO, RAW_VIDEO } from './raw-pipe';

describe('raw-pipe', () => {
  it('sizes I420 as 1.5 bytes per pixel', () => {
    assert.equal(i420FrameSize(1920, 1080), 1920 * 1080 * 1.5);
  });

  it('parses video and audio packets', () => {
    const video = parseRawPacket(Buffer.from([RAW_VIDEO, 1, 2, 3]));
    assert.deepEqual(video, { kind: 'video', payload: Buffer.from([1, 2, 3]) });
    const audio = parseRawPacket(Buffer.from([RAW_AUDIO, 9]));
    assert.deepEqual(audio, { kind: 'audio', payload: Buffer.from([9]) });
  });

  it('rejects empty or unknown packets', () => {
    assert.equal(parseRawPacket(Buffer.alloc(0)), undefined);
    assert.equal(parseRawPacket(Buffer.from([99, 1])), undefined);
  });
});
