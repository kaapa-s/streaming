import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { CommentsModule } from './comments/comments.module';
import {
  PlatformConnection,
  RefreshToken,
  Recording,
  Room,
  RoomMember,
  User,
} from './entities';
import { PlatformsModule } from './platforms/platforms.module';
import { RecordingsModule } from './recordings/recordings.module';
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
        entities: [
          User,
          RefreshToken,
          Room,
          RoomMember,
          Recording,
          PlatformConnection,
        ],
        synchronize: false,
        migrationsRun: true,
        migrations: [__dirname + '/migrations/*.{ts,js}'],
      }),
    }),
    UsersModule,
    AuthModule,
    RoomsModule,
    RecordingsModule,
    PlatformsModule,
    CommentsModule,
  ],
})
export class AppModule {}
