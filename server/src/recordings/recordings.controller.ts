import { Body, Controller, Get, Post } from '@nestjs/common';
import { RecordingsService } from './recordings.service';

@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Post('start')
  start(@Body() body: { room?: string; rtmpUrl?: string; resolution?: string }) {
    return this.recordings.start(body?.room ?? 'main', body?.rtmpUrl, body?.resolution);
  }

  @Post('stop')
  stop(@Body() body: { room?: string }) {
    return this.recordings.stop(body?.room ?? 'main');
  }

  @Get()
  status() {
    return this.recordings.status();
  }
}
