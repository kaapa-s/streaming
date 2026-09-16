import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  effectivePreset,
  layoutSolve,
  sourceId,
  type LayoutSource,
  type LayoutState,
  type Placement,
} from './layout.ts';

const W = 1920;
const H = 1080;

function cam(peerId: string, name = peerId): LayoutSource {
  return { id: sourceId(peerId, 'camera'), peerId, kind: 'camera', name };
}

function screen(peerId: string, name = `${peerId} screen`): LayoutSource {
  return { id: sourceId(peerId, 'screen'), peerId, kind: 'screen', name };
}

function state(
  cameraPreset: LayoutState['cameraPreset'],
  featuredId: string | null,
  sceneScreenIds: string[] = [],
): LayoutState {
  return { cameraPreset, featuredId, sceneScreenIds };
}

function ids(placements: Placement[]): string[] {
  return placements.map((p) => p.sourceId);
}

describe('sourceId', () => {
  it('formats peerId:kind', () => {
    assert.equal(sourceId('p1', 'camera'), 'p1:camera');
    assert.equal(sourceId('p1', 'screen'), 'p1:screen');
  });
});

describe('effectivePreset', () => {
  it('uses cameraPreset when no screen is live', () => {
    assert.equal(effectivePreset(state('grid', 'a:camera'), [cam('a'), cam('b')]), 'grid');
  });

  it('keeps cameraPreset when a screen is live but not on the scene', () => {
    assert.equal(
      effectivePreset(state('grid', 'a:camera'), [cam('a'), screen('a')]),
      'grid',
    );
  });

  it('switches to presentation when a live screen is on the scene', () => {
    assert.equal(
      effectivePreset(state('focus', 'a:camera', ['a:screen']), [cam('a'), screen('a')]),
      'presentation',
    );
  });

  it('ignores sceneScreenIds that are not live', () => {
    assert.equal(
      effectivePreset(state('pip-left', 'a:camera', ['a:screen']), [cam('a')]),
      'pip-left',
    );
  });
});

describe('layoutSolve empty', () => {
  it('returns no placements without cameras or screens', () => {
    assert.deepEqual(layoutSolve(state('focus', null), [], W, H), []);
    assert.deepEqual(layoutSolve(state('grid', null), [], W, H), []);
  });
});

describe('focus', () => {
  it('fills the canvas with the featured camera', () => {
    const placements = layoutSolve(state('focus', 'you:camera'), [cam('you', 'YOU')], W, H);
    assert.deepEqual(placements, [
      { sourceId: 'you:camera', x: 0, y: 0, w: W, h: H, fit: 'cover', label: 'YOU' },
    ]);
  });

  it('hides every camera except the featured one', () => {
    const placements = layoutSolve(
      state('focus', 'you:camera'),
      [cam('g1', 'G1'), cam('you', 'YOU'), cam('g2', 'G2')],
      W,
      H,
    );
    assert.deepEqual(ids(placements), ['you:camera']);
  });

  it('falls back to the first remaining camera by id when featured is missing', () => {
    const placements = layoutSolve(
      state('focus', 'gone:camera'),
      [cam('b', 'B'), cam('a', 'A')],
      W,
      H,
    );
    assert.deepEqual(ids(placements), ['a:camera']);
  });

  it('falls back when featuredId is null', () => {
    const placements = layoutSolve(state('focus', null), [cam('z'), cam('m')], W, H);
    assert.deepEqual(ids(placements), ['m:camera']);
  });
});

describe('pip', () => {
  it('looks like focus when alone', () => {
    const focus = layoutSolve(state('focus', 'you:camera'), [cam('you', 'YOU')], W, H);
    const left = layoutSolve(state('pip-left', 'you:camera'), [cam('you', 'YOU')], W, H);
    const right = layoutSolve(state('pip-right', 'you:camera'), [cam('you', 'YOU')], W, H);
    assert.deepEqual(left, focus);
    assert.deepEqual(right, focus);
  });

  it('stacks other cameras on the left, featured full-bleed underneath', () => {
    const placements = layoutSolve(
      state('pip-left', 'you:camera'),
      [cam('you', 'YOU'), cam('g1', 'G1')],
      W,
      H,
    );
    assert.equal(placements.length, 2);
    assert.deepEqual(placements[0], {
      sourceId: 'you:camera',
      x: 0,
      y: 0,
      w: W,
      h: H,
      fit: 'cover',
      label: 'YOU',
    });
    const pip = placements[1];
    assert.ok(pip);
    assert.equal(pip.sourceId, 'g1:camera');
    assert.equal(pip.fit, 'cover');
    assert.equal(pip.x, 24);
    const tileW = Math.round(W * 0.18);
    const tileH = Math.round(tileW * (9 / 16));
    assert.equal(pip.w, tileW);
    assert.equal(pip.h, tileH);
    assert.equal(pip.y, Math.round((H - tileH) / 2));
  });

  it('stacks 3+ pip tiles top-to-bottom and centered as a group', () => {
    const placements = layoutSolve(
      state('pip-left', 'you:camera'),
      [cam('you', 'YOU'), cam('g2', 'G2'), cam('g1', 'G1'), cam('g3', 'G3')],
      W,
      H,
    );
    assert.deepEqual(ids(placements), ['you:camera', 'g1:camera', 'g2:camera', 'g3:camera']);
    const tiles = placements.slice(1);
    assert.equal(tiles[0]?.x, 24);
    assert.equal(tiles[1]?.x, 24);
    assert.ok(tiles[0] && tiles[1] && tiles[0].y < tiles[1].y);
    assert.equal((tiles[1]?.y ?? 0) - ((tiles[0]?.y ?? 0) + (tiles[0]?.h ?? 0)), 8);
  });

  it('places pip tiles on the right edge for pip-right', () => {
    const placements = layoutSolve(
      state('pip-right', 'you:camera'),
      [cam('you', 'YOU'), cam('g1', 'G1')],
      W,
      H,
    );
    const pip = placements[1];
    assert.ok(pip);
    assert.equal(pip.x, W - 24 - pip.w);
    assert.equal(pip.y, Math.round((H - pip.h) / 2));
  });

  it('scales pip geometry with canvas size', () => {
    const placements = layoutSolve(
      state('pip-left', 'a:camera'),
      [cam('a'), cam('b')],
      640,
      360,
    );
    const pip = placements[1];
    assert.ok(pip);
    assert.equal(pip.w, Math.round(640 * 0.18));
    assert.equal(pip.x, 24);
  });

  it('covers 5 cameras without dropping the featured full-bleed tile', () => {
    const sources = [cam('you'), cam('a'), cam('b'), cam('c'), cam('d')];
    const placements = layoutSolve(state('pip-right', 'you:camera'), sources, W, H);
    assert.equal(placements.length, 5);
    assert.equal(placements[0]?.sourceId, 'you:camera');
    assert.equal(placements[0]?.w, W);
  });
});

describe('grid', () => {
  it('uses the same full-frame box as focus for one camera', () => {
    const sources = [cam('you', 'YOU')];
    assert.deepEqual(
      layoutSolve(state('grid', 'you:camera'), sources, W, H),
      layoutSolve(state('focus', 'you:camera'), sources, W, H),
    );
  });

  it('splits two cameras into equal columns', () => {
    const placements = layoutSolve(
      state('grid', 'you:camera'),
      [cam('g1', 'G1'), cam('you', 'YOU')],
      W,
      H,
    );
    assert.deepEqual(ids(placements), ['you:camera', 'g1:camera']);
    assert.equal(placements[0]?.x, 8);
    assert.equal(placements[0]?.y, 8);
    assert.equal(placements[0]?.w, 948);
    assert.equal(placements[0]?.h, 1064);
    assert.equal(placements[1]?.x, 964);
    assert.equal(placements[1]?.y, 8);
    assert.equal(placements[1]?.w, 948);
  });

  it('uses a 2x2 with an empty cell for three cameras', () => {
    const placements = layoutSolve(
      state('grid', 'you:camera'),
      [cam('you', 'YOU'), cam('g1', 'G1'), cam('g2', 'G2')],
      W,
      H,
    );
    assert.equal(placements.length, 3);
    assert.deepEqual(
      placements.map((p) => ({ id: p.sourceId, x: p.x, y: p.y, w: p.w, h: p.h })),
      [
        { id: 'you:camera', x: 8, y: 8, w: 948, h: 528 },
        { id: 'g1:camera', x: 964, y: 8, w: 948, h: 528 },
        { id: 'g2:camera', x: 8, y: 544, w: 948, h: 528 },
      ],
    );
  });

  it('fills four equal cells', () => {
    const placements = layoutSolve(
      state('grid', 'you:camera'),
      [cam('you', 'YOU'), cam('g1', 'G1'), cam('g2', 'G2'), cam('g3', 'G3')],
      W,
      H,
    );
    assert.equal(placements.length, 4);
    assert.deepEqual(ids(placements), ['you:camera', 'g1:camera', 'g2:camera', 'g3:camera']);
    assert.equal(placements[3]?.x, 964);
    assert.equal(placements[3]?.y, 544);
  });

  it('puts featured first, then remaining cameras by id', () => {
    const placements = layoutSolve(
      state('grid', 'm:camera'),
      [cam('z'), cam('a'), cam('m')],
      W,
      H,
    );
    assert.deepEqual(ids(placements), ['m:camera', 'a:camera', 'z:camera']);
  });
});

describe('deterministic preset coverage invariants', () => {
  for (const preset of ['focus', 'pip-left', 'pip-right', 'grid'] as const) {
    it(`keeps both deterministic cameras bounded for ${preset}`, () => {
      const sources = [cam('alice', 'Alice'), cam('bob', 'Bob')];
      const placements = layoutSolve(state(preset, 'alice:camera'), sources, W, H);
      assert.deepEqual(new Set(ids(placements)), new Set(['alice:camera', ...(preset === 'focus' ? [] : ['bob:camera'])]));
      for (const placement of placements) {
        assert.ok(Number.isInteger(placement.x) && Number.isInteger(placement.y));
        assert.ok(Number.isInteger(placement.w) && Number.isInteger(placement.h));
        assert.ok(placement.w > 0 && placement.h > 0, `${preset} produced invalid dimensions`);
        assert.ok(placement.x >= 0 && placement.y >= 0, `${preset} produced negative placement`);
        assert.ok(placement.x + placement.w <= W && placement.y + placement.h <= H, `${preset} exceeded canvas bounds`);
      }
    });
  }

  it('keeps a deterministic screen source through the active presentation transition', () => {
    const sources = [cam('alice', 'Alice'), cam('bob', 'Bob'), screen('alice', 'Screen')];
    const placements = layoutSolve(state('focus', 'alice:camera', ['alice:screen']), sources, W, H);
    assert.deepEqual(ids(placements), ['alice:camera', 'bob:camera', 'alice:screen']);
    for (const placement of placements) {
      assert.ok(placement.w > 0 && placement.h > 0);
      assert.ok(placement.x >= 0 && placement.y >= 0);
      assert.ok(placement.x + placement.w <= W && placement.y + placement.h <= H);
    }
  });
});

describe('presentation', () => {
  it('places one camera in the left strip and contain-fits the screen', () => {
    const placements = layoutSolve(
      state('focus', 'you:camera', ['you:screen']),
      [cam('you', 'YOU'), screen('you', 'SCREEN')],
      W,
      H,
    );
    assert.equal(
      effectivePreset(state('focus', 'you:camera', ['you:screen']), [cam('you'), screen('you')]),
      'presentation',
    );
    assert.deepEqual(ids(placements), ['you:camera', 'you:screen']);
    assert.equal(placements[0]?.x, 8);
    assert.equal(placements[0]?.w, 260);
    assert.equal(placements[0]?.fit, 'cover');
    assert.deepEqual(placements[1], {
      sourceId: 'you:screen',
      x: 276,
      y: 8,
      w: 1636,
      h: 1064,
      fit: 'contain',
    });
  });

  it('stacks two cameras featured-first in the strip', () => {
    const placements = layoutSolve(
      state('grid', 'you:camera', ['you:screen']),
      [cam('g1', 'G1'), cam('you', 'YOU'), screen('you')],
      W,
      H,
    );
    assert.deepEqual(ids(placements), ['you:camera', 'g1:camera', 'you:screen']);
    assert.equal(placements[0]?.y !== placements[1]?.y, true);
    assert.equal(placements[0]?.x, placements[1]?.x);
  });

  it('stacks three cameras in the strip', () => {
    const placements = layoutSolve(
      state('pip-left', 'you:camera', ['g1:screen']),
      [cam('you', 'YOU'), cam('g1', 'G1'), cam('g2', 'G2'), screen('g1')],
      W,
      H,
    );
    assert.deepEqual(ids(placements), ['you:camera', 'g1:camera', 'g2:camera', 'g1:screen']);
    assert.equal(placements[0]?.fit, 'cover');
    assert.equal(placements[3]?.fit, 'contain');
  });

  it('picks the first screen by sourceId when two are live', () => {
    const placements = layoutSolve(
      state('focus', 'a:camera', ['b:screen', 'a:screen']),
      [cam('a'), cam('b'), screen('b'), screen('a')],
      W,
      H,
    );
    const screens = placements.filter((p) => p.fit === 'contain');
    assert.deepEqual(
      screens.map((p) => p.sourceId),
      ['a:screen'],
    );
  });

  it('still shows a screen with no cameras', () => {
    const placements = layoutSolve(state('focus', null, ['a:screen']), [screen('a')], W, H);
    assert.deepEqual(ids(placements), ['a:screen']);
    assert.equal(placements[0]?.fit, 'contain');
  });

  it('keeps the camera preset when a live screen is not on the scene', () => {
    const placements = layoutSolve(
      state('focus', 'a:camera'),
      [cam('a', 'A'), screen('a')],
      W,
      H,
    );
    assert.deepEqual(ids(placements), ['a:camera']);
    assert.equal(placements[0]?.w, W);
  });

  it('uses only scene-active screens for the main area', () => {
    const placements = layoutSolve(
      state('focus', 'a:camera', ['b:screen']),
      [cam('a'), cam('b'), screen('a'), screen('b')],
      W,
      H,
    );
    const screens = placements.filter((p) => p.fit === 'contain');
    assert.deepEqual(
      screens.map((p) => p.sourceId),
      ['b:screen'],
    );
  });
});
