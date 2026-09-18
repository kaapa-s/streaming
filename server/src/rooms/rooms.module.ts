import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Room, RoomBlock, RoomInvite, RoomMember } from '../entities';
import { RecordingsModule } from '../recordings/recordings.module';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Room, RoomMember, RoomInvite, RoomBlock]),
    forwardRef(() => RecordingsModule),
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
