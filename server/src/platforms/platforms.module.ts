import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformConnection } from '../entities/platform-connection.entity';
import { PlatformsController } from './platforms.controller';
import { YoutubeOAuthService } from './youtube-oauth.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformConnection])],
  controllers: [PlatformsController],
  providers: [YoutubeOAuthService],
  exports: [YoutubeOAuthService],
})
export class PlatformsModule {}
