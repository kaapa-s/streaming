import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { resolveDestinations } from './destinations';

describe('resolveDestinations', () => {
  it('returns nothing for a local recording', () => {
    assert.deepEqual(resolveDestinations({}), []);
  });

  it('treats a legacy rtmpUrl as YouTube', () => {
    assert.deepEqual(resolveDestinations({ rtmpUrl: ' abcd1234 ' }), [
      { platform: 'youtube', streamKey: 'abcd1234' },
    ]);
  });

  it('rejects duplicate platforms and empty keys', () => {
    assert.throws(
      () =>
        resolveDestinations({
          destinations: [
            { platform: 'youtube', streamKey: 'aaaa1111' },
            { platform: 'youtube', streamKey: 'bbbb2222' },
          ],
        }),
      BadRequestException,
    );
    assert.throws(
      () =>
        resolveDestinations({
          destinations: [{ platform: 'facebook', streamKey: '  ' }],
        }),
      BadRequestException,
    );
  });

  it('prefers destinations over rtmpUrl', () => {
    assert.deepEqual(
      resolveDestinations({
        rtmpUrl: 'legacy',
        destinations: [
          { platform: 'facebook', streamKey: 'fbkey' },
          { platform: 'x', streamKey: 'rtmp://live.x.com/app/key' },
        ],
      }),
      [
        { platform: 'facebook', streamKey: 'fbkey' },
        { platform: 'x', streamKey: 'rtmp://live.x.com/app/key' },
      ],
    );
  });
});
