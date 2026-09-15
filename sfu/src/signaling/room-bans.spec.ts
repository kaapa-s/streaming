import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BAN_TTL_MS, CLOSED_TTL_MS, RoomBans } from './room-bans';

function atClock() {
  let now = 1_000_000;
  const bans = new RoomBans(() => now);
  return { bans, advance: (ms: number) => (now += ms) };
}

describe('RoomBans', () => {
  it('bans one user in one room only', () => {
    const { bans } = atClock();
    bans.ban('room-a', 'user-1');
    assert.equal(bans.isBanned('room-a', 'user-1'), true);
    assert.equal(bans.isBanned('room-a', 'user-2'), false);
    assert.equal(bans.isBanned('room-b', 'user-1'), false);
  });

  it('expires a ban once the token it outlives is dead', () => {
    const { bans, advance } = atClock();
    bans.ban('room-a', 'user-1');
    advance(BAN_TTL_MS - 1);
    assert.equal(bans.isBanned('room-a', 'user-1'), true);
    advance(2);
    assert.equal(bans.isBanned('room-a', 'user-1'), false);
  });

  it('drops the room entry when its last ban expires', () => {
    const { bans, advance } = atClock();
    bans.ban('room-a', 'user-1');
    advance(BAN_TTL_MS + 1);
    bans.isBanned('room-a', 'user-1');
    assert.deepEqual(bans.size(), { bans: 0, closed: 0 });
  });

  it('marks a room closed and expires that too', () => {
    const { bans, advance } = atClock();
    bans.close('room-a');
    assert.equal(bans.isClosed('room-a'), true);
    assert.equal(bans.isClosed('room-b'), false);
    advance(CLOSED_TTL_MS + 1);
    assert.equal(bans.isClosed('room-a'), false);
  });

  it('prune clears expired entries but keeps live ones', () => {
    const { bans, advance } = atClock();
    bans.ban('room-a', 'user-1');
    bans.close('room-a');
    advance(BAN_TTL_MS + 1);
    bans.ban('room-b', 'user-2');
    bans.prune();
    assert.deepEqual(bans.size(), { bans: 1, closed: 1 });
    assert.equal(bans.isBanned('room-b', 'user-2'), true);
    assert.equal(bans.isBanned('room-a', 'user-1'), false);
  });

  it('re-banning refreshes the window', () => {
    const { bans, advance } = atClock();
    bans.ban('room-a', 'user-1');
    advance(BAN_TTL_MS - 10);
    bans.ban('room-a', 'user-1');
    advance(20);
    assert.equal(bans.isBanned('room-a', 'user-1'), true);
  });
});
