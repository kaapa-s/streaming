import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_ROOM_LAYOUT, normalizeRoomLayout } from './room-layout';

describe('normalizeRoomLayout', () => {
  it('falls back to the default layout for missing or malformed input', () => {
    for (const input of [null, undefined, 'nope', 7, []]) {
      assert.deepEqual(normalizeRoomLayout(input), DEFAULT_ROOM_LAYOUT);
    }
  });

  it('keeps a valid layout untouched', () => {
    const layout = {
      cameraPreset: 'grid' as const,
      featuredId: 'p1:camera',
      sceneScreenIds: ['p2:screen'],
    };
    assert.deepEqual(normalizeRoomLayout(layout), layout);
  });

  it('rejects an unknown preset and empty ids', () => {
    const got = normalizeRoomLayout({
      cameraPreset: 'sidebar',
      featuredId: '',
      sceneScreenIds: ['p2:screen'],
    });
    assert.equal(got.cameraPreset, 'focus');
    assert.equal(got.featuredId, null);
    assert.deepEqual(got.sceneScreenIds, ['p2:screen']);
  });

  it('drops non-string screen ids instead of 500ing on a legacy row', () => {
    const got = normalizeRoomLayout({
      cameraPreset: 'pip-left',
      featuredId: 42,
      sceneScreenIds: ['ok:screen', null, 3, 'still:screen'],
    });
    assert.equal(got.featuredId, null);
    assert.deepEqual(got.sceneScreenIds, ['ok:screen', 'still:screen']);
  });

  it('treats a non-array sceneScreenIds as empty', () => {
    const got = normalizeRoomLayout({ sceneScreenIds: 'p1:screen' });
    assert.deepEqual(got.sceneScreenIds, []);
  });

  it('returns a copy of the default, never the shared object', () => {
    const got = normalizeRoomLayout(null);
    assert.notEqual(got, DEFAULT_ROOM_LAYOUT);
    assert.notEqual(got.sceneScreenIds, DEFAULT_ROOM_LAYOUT.sceneScreenIds);
  });
});
