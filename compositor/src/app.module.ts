import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BrowserPoolService } from './browser/browser-pool.service';
import { RecordingGateway } from './recordings/recording.gateway';
import { SessionsController } from './sessions/sessions.controller';
import { SessionsService } from './sessions/sessions.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [SessionsController],
  providers: [BrowserPoolService, SessionsService, RecordingGateway],
})
export class AppModule {}
