import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RoomsService } from './rooms.service';

const SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const STALE_AFTER_HOURS = 12;

/**
 * Rooms are ephemeral, but "end stream" is an explicit action — an owner who
 * just closes the tab leaves the room open and its invite link live forever.
 * This closes those. Plain setInterval on purpose: @nestjs/schedule is not a
 * dependency and this does not warrant adding one.
 *
 * Note this only closes the DB row. The compositor's own idle reaper is what
 * reclaims the Chromium slot, and it runs on a much shorter fuse.
 */
@Injectable()
export class RoomSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomSweeperService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly rooms: RoomsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async sweep(): Promise<number> {
    try {
      const closed = await this.rooms.closeStaleRooms(STALE_AFTER_HOURS);
      if (closed > 0) {
        this.logger.log(`closed ${closed} stale room(s) older than ${STALE_AFTER_HOURS}h`);
      }
      return closed;
    } catch (err) {
      this.logger.warn(`room sweep failed: ${String(err)}`);
      return 0;
    }
  }
}
