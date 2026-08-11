import { Module } from '@nestjs/common';
import { PlatformsModule } from '../platforms/platforms.module';
import { RecordingsModule } from '../recordings/recordings.module';
import { RoomsModule } from '../rooms/rooms.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { YoutubeLiveChatAdapter } from './youtube-live-chat.adapter';

@Module({
  imports: [RoomsModule, PlatformsModule, RecordingsModule],
  controllers: [CommentsController],
  providers: [CommentsService, YoutubeLiveChatAdapter],
  exports: [CommentsService],
})
export class CommentsModule {}
