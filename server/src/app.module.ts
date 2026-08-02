import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import {
  RefreshToken,
  Recording,
  Room,
  RoomMember,
  User,
} from './entities';
import { RecordingGateway } from './recordings/recording.gateway';
import { RecordingsController } from './recordings/recordings.controller';
import { RecordingsService } from './recordings/recordings.service';
import { RoomsModule } from './rooms/rooms.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('DATABASE_URL'),
        entities: [User, RefreshToken, Room, RoomMember, Recording],
        synchronize: false,
        migrationsRun: true,
        migrations: [__dirname + '/migrations/*.{ts,js}'],
      }),
    }),
    TypeOrmModule.forFeature([Recording]),
    UsersModule,
    AuthModule,
    RoomsModule,
  ],
  controllers: [RecordingsController],
  providers: [RecordingGateway, RecordingsService],
})
export class AppModule {}
