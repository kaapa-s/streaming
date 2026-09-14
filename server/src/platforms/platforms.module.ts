import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformConnection } from '../entities/platform-connection.entity';
import { FacebookOAuthService } from './facebook-oauth.service';
import { InstagramOAuthService } from './instagram-oauth.service';
import { LinkedinOAuthService } from './linkedin-oauth.service';
import { PlatformConnectionStore } from './platform-connection.store';
import { PlatformOAuthRegistry } from './platform-oauth.registry';
import { PlatformsController } from './platforms.controller';
import { XOAuthService } from './x-oauth.service';
import { YoutubeOAuthService } from './youtube-oauth.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformConnection])],
  controllers: [PlatformsController],
  providers: [
    PlatformConnectionStore,
    YoutubeOAuthService,
    FacebookOAuthService,
    InstagramOAuthService,
    LinkedinOAuthService,
    XOAuthService,
    PlatformOAuthRegistry,
  ],
  exports: [YoutubeOAuthService, PlatformConnectionStore],
})
export class PlatformsModule {}
