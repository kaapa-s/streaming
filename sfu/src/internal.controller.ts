import { Body, Controller, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { MediasoupService } from './mediasoup/mediasoup.service';
import { SignalingGateway } from './signaling/signaling.gateway';

@Controller('internal')
export class InternalController {
  constructor(private readonly signaling: SignalingGateway, private readonly mediasoup: MediasoupService) {}

  /** Prefer the dedicated internal secret, but accept the shared join secret locally. */
  private expectedSecret(): string | undefined {
    return process.env.SFU_INTERNAL_SECRET?.trim() || process.env.SFU_JOIN_SECRET?.trim();
  }

  @Post('rooms/:slug/kick')
  async kick(
    @Param('slug') slug: string,
    @Body() body: { userId?: string },
    @Headers('x-internal-secret') secret?: string,
  ) {
    const expected = this.expectedSecret();
    if (!expected || secret !== expected || !body.userId) throw new UnauthorizedException();
    await this.signaling.kickUser(slug, body.userId);
    return { room: slug.trim().toLowerCase(), kicked: true };
  }

  @Post('rooms/:slug/discard')
  async discard(@Param('slug') slug: string, @Headers('x-internal-secret') secret?: string) {
    const expected = this.expectedSecret();
    if (!expected || secret !== expected) throw new UnauthorizedException();
    await this.signaling.closeRoom(slug);
    // closeRoom also closes the router; keeping the service dependency here makes
    // the lifecycle explicit if no peer ever connected and the gateway had no set.
    await this.mediasoup.closeRouter(slug);
    return { room: slug.trim().toLowerCase(), discarded: true };
  }
}
