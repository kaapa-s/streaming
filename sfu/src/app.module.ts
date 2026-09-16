import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MediasoupService } from './mediasoup/mediasoup.service';
import { SignalingGateway } from './signaling/signaling.gateway';
import { InternalController } from './internal.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [MediasoupService, SignalingGateway],
  controllers: [InternalController],
})
export class AppModule {}
