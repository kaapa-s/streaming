import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDurationSeconds } from './recording-validation.mjs';

test('derives duration from video timestamps when WebM metadata duration is zero', () => {
  const result = deriveDurationSeconds('0', [0, 0.0167, 0.0334, 12.008]);
  assert.equal(result.source, 'video-timestamps');
  assert.ok(result.seconds >= 12.008 && result.seconds < 12.1);
});

test('prefers a positive explicit duration', () => {
  assert.deepEqual(deriveDurationSeconds('4.25', [0, 4]), { seconds: 4.25, source: 'metadata' });
});
