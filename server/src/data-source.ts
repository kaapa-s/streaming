import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import {
  PlatformConnection,
  RefreshToken,
  Recording,
  Room,
  RoomBlock,
  RoomInvite,
  RoomMember,
  User,
} from './entities';

loadEnv();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, RefreshToken, Room, RoomMember, RoomInvite, RoomBlock, Recording, PlatformConnection],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
