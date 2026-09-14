import { BadRequestException, Injectable } from '@nestjs/common';
import { FacebookOAuthService } from './facebook-oauth.service';
import { InstagramOAuthService } from './instagram-oauth.service';
import { LinkedinOAuthService } from './linkedin-oauth.service';
import { isPlatformProvider, type PlatformProvider } from './platform-ids';
import { XOAuthService } from './x-oauth.service';
import { YoutubeOAuthService } from './youtube-oauth.service';

export interface PlatformOAuthHandler {
  readonly provider: PlatformProvider;
  buildConnectUrl(userId: string): { url: string };
  handleCallback(code: string | undefined, state: string | undefined): Promise<string>;
}

@Injectable()
export class PlatformOAuthRegistry {
  private readonly handlers: Record<PlatformProvider, PlatformOAuthHandler>;

  constructor(
    youtube: YoutubeOAuthService,
    facebook: FacebookOAuthService,
    instagram: InstagramOAuthService,
    linkedin: LinkedinOAuthService,
    x: XOAuthService,
  ) {
    this.handlers = {
      youtube,
      facebook,
      instagram,
      linkedin,
      x,
    };
  }

  get(provider: string): PlatformOAuthHandler {
    if (!isPlatformProvider(provider)) {
      throw new BadRequestException(`unknown platform ${provider}`);
    }
    return this.handlers[provider];
  }
}
