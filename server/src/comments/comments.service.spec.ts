import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { AuthUser } from '../auth/jwt.strategy';
import { CommentsService } from './comments.service';
import type { PollCommentsResult, ResolvedChatSession } from './types';
import { YoutubeLiveChatAdapter } from './youtube-live-chat.adapter';

const owner: AuthUser = { id: 'owner-1', email: 'owner@example.com', name: 'Owner' };

class FakeRooms {
  async requireActiveMembershipBySlug(slug: string, _userId: string) {
    return {
      room: { slug: slug.trim().toLowerCase(), id: 'room-1', ownerId: owner.id },
      member: { role: 'owner' as const },
    };
  }
}

class FakeOauth {
  async getValidAccessToken(_userId: string): Promise<string> {
    return 'access-token';
  }
}

class FakeChat extends YoutubeLiveChatAdapter {
  resolveImpl: () => Promise<ResolvedChatSession> = async () => ({
    chatId: 'chat-1',
    title: 'Live show',
    videoId: 'vid-1',
  });
  pollImpl: () => Promise<PollCommentsResult> = async () => ({
    comments: [],
    pollingIntervalMs: 60_000,
  });
  postReplyImpl: YoutubeLiveChatAdapter['postReply'] = async (_token, _chatId, text) => ({
    id: `reply-${text}`,
    platform: 'youtube',
    author: 'You',
    text,
    publishedAt: new Date().toISOString(),
    canReply: true,
  });

  override resolveChatSession(): Promise<ResolvedChatSession> {
    return this.resolveImpl();
  }

  override pollComments(): Promise<PollCommentsResult> {
    return this.pollImpl();
  }

  override postReply(
    accessToken: string,
    chatId: string,
    text: string,
  ): ReturnType<YoutubeLiveChatAdapter['postReply']> {
    return this.postReplyImpl(accessToken, chatId, text);
  }
}

class FakeCompositor {
  async setOverlay(
    slug: string,
    _overlay: { author: string; text: string; until: number } | null,
  ): Promise<{ room: string; ok: boolean }> {
    return { room: slug, ok: true };
  }
}

function makeService(chat: FakeChat): CommentsService {
  const service = new CommentsService(
    new FakeRooms(),
    new FakeOauth(),
    chat,
    new FakeCompositor(),
  );
  service.sleepFn = () => new Promise((resolve) => setImmediate(resolve));
  service.bindSlowRetryMs = 60_000;
  return service;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('CommentsService session lifecycle', () => {
  let service: CommentsService;

  afterEach(() => {
    service?.stopSession('main');
  });

  it('creates a connecting session before chatId exists; reply is connecting not missing', async () => {
    const chat = new FakeChat();
    chat.resolveImpl = () => new Promise(() => undefined);
    service = makeService(chat);

    service.bindForLiveRoom('main', owner.id);
    assert.equal(service.sessionBindStatus('main'), 'connecting');

    await assert.rejects(
      () => service.reply('main', owner, 'hello'),
      (err: unknown) => err instanceof ServiceUnavailableException,
    );
  });

  it('does not delete the session after pollOnce with zero SSE subscribers', async () => {
    const chat = new FakeChat();
    let polls = 0;
    chat.pollImpl = async () => {
      polls += 1;
      return { comments: [], pollingIntervalMs: 60_000 };
    };
    service = makeService(chat);

    service.bindForLiveRoom('main', owner.id);
    await waitFor(() => service.sessionBindStatus('main') === 'active');
    await waitFor(() => polls >= 1);

    assert.equal(service.sessionBindStatus('main'), 'active');
    const comment = await service.reply('main', owner, 'still here');
    assert.equal(comment.text, 'still here');
  });

  it('does not delete the session when the last SSE subscriber detaches', async () => {
    const chat = new FakeChat();
    chat.pollImpl = async () => ({ comments: [], pollingIntervalMs: 60_000 });
    service = makeService(chat);

    service.bindForLiveRoom('main', owner.id);
    await waitFor(() => service.sessionBindStatus('main') === 'active');

    const subscription = service.streamComments('main', owner).subscribe({
      next() {
        /* ignore */
      },
      error() {
        /* ignore */
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    subscription.unsubscribe();

    assert.equal(service.sessionBindStatus('main'), 'active');
    await service.reply('main', owner, 'after detach');
  });

  it('marks bind failed after retries are exhausted', async () => {
    const chat = new FakeChat();
    chat.resolveImpl = async () => {
      throw new BadRequestException('No active YouTube broadcast yet');
    };
    service = makeService(chat);
    service.bindDeadlineMs = 0;
    service.sleepFn = () => new Promise((resolve) => setTimeout(resolve, 5));

    service.bindForLiveRoom('main', owner.id);
    await waitFor(() => service.sessionBindStatus('main') === 'failed');
    await assert.rejects(
      () => service.reply('main', owner, 'hello'),
      (err: unknown) => err instanceof ServiceUnavailableException,
    );
    service.stopSession('main');
  });
});
