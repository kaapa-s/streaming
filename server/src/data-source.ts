import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { RefreshToken, Recording, Room, RoomMember, User } from './entities';

loadEnv();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, RefreshToken, Room, RoomMember, Recording],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
