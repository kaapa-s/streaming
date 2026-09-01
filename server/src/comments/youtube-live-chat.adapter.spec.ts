import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { pickLiveBroadcast, YoutubeLiveChatAdapter } from './youtube-live-chat.adapter';

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

describe('pickLiveBroadcast', () => {
  it('prefers an active broadcast with liveChatId', () => {
    const resolved = pickLiveBroadcast(
      [{ id: 'active-1', snippet: { liveChatId: 'chat-active', title: 'Active' } }],
      [
        {
          id: 'up-1',
          snippet: { liveChatId: 'chat-up', title: 'Upcoming' },
          status: { lifeCycleStatus: 'testing' },
        },
      ],
    );
    assert.deepEqual(resolved, {
      chatId: 'chat-active',
      videoId: 'active-1',
      title: 'Active',
    });
  });

  it('falls back to an upcoming testing/live broadcast with liveChatId', () => {
    const resolved = pickLiveBroadcast(
      [],
      [
        { id: 'ready', snippet: { title: 'Ready' }, status: { lifeCycleStatus: 'ready' } },
        {
          id: 'testing',
          snippet: { liveChatId: 'chat-test', title: 'Testing' },
          status: { lifeCycleStatus: 'testing' },
        },
      ],
    );
    assert.deepEqual(resolved, {
      chatId: 'chat-test',
      videoId: 'testing',
      title: 'Testing',
    });
  });

  it('returns undefined when neither list has a chat id', () => {
    assert.equal(
      pickLiveBroadcast([{ id: 'a', snippet: { title: 'No chat' } }], []),
      undefined,
    );
  });
});

describe('YoutubeLiveChatAdapter.resolveChatSession', () => {
  const adapter = new YoutubeLiveChatAdapter();
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses the active broadcast when present', async () => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('broadcastStatus=active')) {
        return jsonResponse({
          items: [{ id: 'v-active', snippet: { liveChatId: 'c-active', title: 'Now' } }],
        });
      }
      if (url.includes('broadcastStatus=upcoming')) {
        return jsonResponse({ items: [] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const resolved = await adapter.resolveChatSession({ accessToken: 't' });
    assert.equal(resolved.chatId, 'c-active');
    assert.equal(resolved.videoId, 'v-active');
  });

  it('falls back to upcoming testing broadcasts', async () => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('broadcastStatus=active')) {
        return jsonResponse({ items: [] });
      }
      if (url.includes('broadcastStatus=upcoming')) {
        return jsonResponse({
          items: [
            {
              id: 'v-test',
              snippet: { liveChatId: 'c-test', title: 'Preview' },
              status: { lifeCycleStatus: 'testing' },
            },
          ],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const resolved = await adapter.resolveChatSession({ accessToken: 't' });
    assert.equal(resolved.chatId, 'c-test');
    assert.equal(resolved.title, 'Preview');
  });

  it('throws when no broadcast has a live chat id', async () => {
    globalThis.fetch = (async () => jsonResponse({ items: [] })) as typeof fetch;

    await assert.rejects(
      () => adapter.resolveChatSession({ accessToken: 't' }),
      (err: unknown) => err instanceof BadRequestException,
    );
  });
});

describe('YoutubeLiveChatAdapter live chat messages', () => {
  const adapter = new YoutubeLiveChatAdapter();
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('lists messages from liveChat/messages with a valid maxResults', async () => {
    let requested: string | undefined;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requested = String(input);
      return jsonResponse({
        items: [
          {
            id: 'm1',
            snippet: {
              type: 'textMessageEvent',
              displayMessage: 'hello',
              publishedAt: '2026-01-01T00:00:00Z',
            },
            authorDetails: { displayName: 'Viewer' },
          },
        ],
        nextPageToken: 'tok',
        pollingIntervalMillis: 5000,
      });
    }) as typeof fetch;

    const result = await adapter.pollComments('t', 'chat-1');
    assert.match(requested ?? '', /\/liveChat\/messages\?/);
    assert.match(requested ?? '', /maxResults=200/);
    assert.equal(result.comments[0]?.text, 'hello');
  });

  it('posts replies to liveChat/messages', async () => {
    let requested: string | undefined;
    let method: string | undefined;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requested = String(input);
      method = init?.method;
      return jsonResponse({
        id: 'r1',
        snippet: { displayMessage: 'hi', textMessageDetails: { messageText: 'hi' } },
        authorDetails: { displayName: 'You' },
      });
    }) as typeof fetch;

    const comment = await adapter.postReply('t', 'chat-1', 'hi');
    assert.equal(method, 'POST');
    assert.match(requested ?? '', /\/liveChat\/messages\?part=snippet/);
    assert.equal(comment.text, 'hi');
  });

  it('includes HTTP status when insert fails with an empty body', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
        text: async () => '',
      }) as Response) as typeof fetch;

    await assert.rejects(
      () => adapter.postReply('t', 'chat-1', 'hi'),
      (err: unknown) =>
        err instanceof BadRequestException && err.message.includes('404'),
    );
  });
});
