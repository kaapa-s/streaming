import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MediasoupService } from './mediasoup/mediasoup.service';
import { SignalingGateway } from './signaling/signaling.gateway';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [MediasoupService, SignalingGateway],
})
export class AppModule {}
