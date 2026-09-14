import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signOAuthState, verifyOAuthState } from './oauth-state';
import { isPlatformProvider, PLATFORM_PROVIDERS } from './platform-ids';

describe('platform ids', () => {
  it('accepts known providers', () => {
    for (const id of PLATFORM_PROVIDERS) {
      assert.equal(isPlatformProvider(id), true);
    }
    assert.equal(isPlatformProvider('twitch'), false);
  });
});

describe('oauth state', () => {
  it('round-trips user id, provider, and PKCE verifier', () => {
    const state = signOAuthState('user-1', { provider: 'x', codeVerifier: 'abc' });
    const payload = verifyOAuthState(state);
    assert.equal(payload.userId, 'user-1');
    assert.equal(payload.provider, 'x');
    assert.equal(payload.codeVerifier, 'abc');
  });
});
