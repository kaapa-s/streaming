import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recording } from '../entities';
import { RoomsModule } from '../rooms/rooms.module';
import { CompositorClient } from './compositor.client';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { S3PresignService } from './s3-presign.service';

@Module({
  imports: [TypeOrmModule.forFeature([Recording]), forwardRef(() => RoomsModule)],
  controllers: [RecordingsController],
  providers: [RecordingsService, CompositorClient, S3PresignService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
