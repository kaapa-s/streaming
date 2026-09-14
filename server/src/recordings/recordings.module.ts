import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommentsModule } from '../comments/comments.module';
import { Recording } from '../entities';
import { PlatformsModule } from '../platforms/platforms.module';
import { RoomsModule } from '../rooms/rooms.module';
import { CompositorClient } from './compositor.client';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { S3PresignService } from './s3-presign.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Recording]),
    forwardRef(() => RoomsModule),
    forwardRef(() => CommentsModule),
    PlatformsModule,
  ],
  controllers: [RecordingsController],
  providers: [RecordingsService, CompositorClient, S3PresignService],
  exports: [RecordingsService, CompositorClient],
})
export class RecordingsModule {}
