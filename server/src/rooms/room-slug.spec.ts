import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomRoomSlug } from './room-slug';

test('slug is 24 lowercase hex chars', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.match(randomRoomSlug(), /^[0-9a-f]{24}$/);
  }
});

test('slug survives the .trim().toLowerCase() normalization every service applies', () => {
  for (let i = 0; i < 50; i += 1) {
    const slug = randomRoomSlug();
    assert.equal(slug.trim().toLowerCase(), slug);
  }
});

test('slug never collides across a large sample', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i += 1) seen.add(randomRoomSlug());
  assert.equal(seen.size, 5000);
});

test('slug can never be mistaken for a UUID', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (let i = 0; i < 50; i += 1) {
    assert.equal(uuid.test(randomRoomSlug()), false);
  }
});
