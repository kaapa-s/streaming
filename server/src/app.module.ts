import { Module } from '@nestjs/common';
import { MediasoupService } from './mediasoup/mediasoup.service';
import { SignalingGateway } from './signaling/signaling.gateway';
import { RecordingGateway } from './recordings/recording.gateway';
import { RecordingsController } from './recordings/recordings.controller';
import { RecordingsService } from './recordings/recordings.service';

@Module({
  controllers: [RecordingsController],
  providers: [MediasoupService, SignalingGateway, RecordingGateway, RecordingsService],
})
export class AppModule {}
