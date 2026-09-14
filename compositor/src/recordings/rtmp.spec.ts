import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { STREAM_PROFILES } from '@streaming/stream-quality';
import {
  buildFfmpegArgs,
  buildTeeSpec,
  collectRtmpUrls,
  escapeTeeUrl,
  normalizeRtmpUrl,
  redactFfmpegArg,
  redactRtmp,
} from './rtmp';

describe('normalizeRtmpUrl', () => {
  it('passes through a full YouTube RTMP URL', () => {
    const url = 'rtmp://a.rtmp.youtube.com/live2/abc12345';
    assert.equal(normalizeRtmpUrl(url), url);
  });

  it('prefixes a bare YouTube key', () => {
    assert.equal(
      normalizeRtmpUrl('abcd1234'),
      'rtmp://a.rtmp.youtube.com/live2/abcd1234',
    );
  });

  it('prefixes Facebook and Instagram bare keys as RTMPS', () => {
    const fb = normalizeRtmpUrl('streamkey99', 'facebook');
    const ig = normalizeRtmpUrl('streamkey99', 'instagram');
    assert.equal(fb, 'rtmps://live-api-s.facebook.com:443/rtmp/streamkey99');
    assert.equal(ig, fb);
  });

  it('requires a full URL for LinkedIn and X', () => {
    assert.throws(() => normalizeRtmpUrl('abcd1234', 'linkedin'), BadRequestException);
    assert.throws(() => normalizeRtmpUrl('abcd1234', 'x'), BadRequestException);
    const li = 'rtmp://live.linkedin.com/x/my-stream-key';
    assert.equal(normalizeRtmpUrl(li, 'linkedin'), li);
  });

  it('rejects URLs that omit the stream key', () => {
    assert.throws(
      () => normalizeRtmpUrl('rtmp://a.rtmp.youtube.com/live2'),
      BadRequestException,
    );
  });
});

describe('collectRtmpUrls', () => {
  it('merges rtmpUrl and rtmpUrls without duplicates', () => {
    assert.deepEqual(
      collectRtmpUrls({
        rtmpUrl: 'rtmp://a.example/live/one',
        rtmpUrls: ['rtmp://a.example/live/two', 'rtmp://a.example/live/one'],
      }),
      ['rtmp://a.example/live/one', 'rtmp://a.example/live/two'],
    );
  });
});

describe('ffmpeg tee', () => {
  it('escapes colon and builds a tee spec with onfail=ignore', () => {
    const url = 'rtmps://live-api-s.facebook.com:443/rtmp/key';
    assert.equal(escapeTeeUrl(url), 'rtmps\\://live-api-s.facebook.com\\:443/rtmp/key');
    assert.equal(
      buildTeeSpec([url, 'rtmp://a.rtmp.youtube.com/live2/abc']),
      '[f=flv:onfail=ignore]rtmps\\://live-api-s.facebook.com\\:443/rtmp/key|[f=flv:onfail=ignore]rtmp\\://a.rtmp.youtube.com/live2/abc',
    );
  });

  it('uses -f flv for a single destination and tee for many', () => {
    const profile = STREAM_PROFILES['1080p'];
    const one = buildFfmpegArgs(profile, 'h264', ['rtmp://a.rtmp.youtube.com/live2/abc']);
    assert.deepEqual(one.slice(-2), ['flv', 'rtmp://a.rtmp.youtube.com/live2/abc']);
    assert.equal(one.includes('tee'), false);

    const many = buildFfmpegArgs(profile, 'h264', [
      'rtmp://a.rtmp.youtube.com/live2/abc',
      'rtmps://live-api-s.facebook.com:443/rtmp/key',
    ]);
    assert.equal(many.includes('tee'), true);
    assert.equal(many.includes('-use_fifo'), true);
    const spec = many.at(-1);
    assert.ok(spec && spec.includes('onfail=ignore'));
    assert.ok(spec.includes('rtmps\\://'));
  });

  it('redacts keys inside a tee spec', () => {
    const spec = buildTeeSpec(['rtmp://a.rtmp.youtube.com/live2/secretkey']);
    assert.equal(redactFfmpegArg(spec).includes('secretkey'), false);
    assert.equal(redactRtmp('rtmp://a.rtmp.youtube.com/live2/secretkey').endsWith('***'), true);
  });
});
