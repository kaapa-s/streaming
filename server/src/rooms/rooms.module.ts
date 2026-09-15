import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Room, RoomMember, User } from '../entities';
import { RecordingsModule } from '../recordings/recordings.module';
import { RoomSweeperService } from './room-sweeper.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Room, RoomMember, User]),
    forwardRef(() => RecordingsModule),
  ],
  controllers: [RoomsController],
  providers: [RoomsService, RoomSweeperService],
  exports: [RoomsService],
})
export class RoomsModule {}
