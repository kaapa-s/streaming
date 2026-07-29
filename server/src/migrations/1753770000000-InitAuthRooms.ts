import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitAuthRooms1753770000000 implements MigrationInterface {
  name = 'InitAuthRooms1753770000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying NOT NULL,
        "passwordHash" character varying NOT NULL,
        "name" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "tokenHash" character varying NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_userId" ON "refresh_tokens" ("userId")`);

    await queryRunner.query(`
      CREATE TABLE "rooms" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "slug" character varying NOT NULL,
        "ownerId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rooms_slug" UNIQUE ("slug"),
        CONSTRAINT "PK_rooms" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rooms_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "room_members" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "roomId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "role" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_room_members_room_user" UNIQUE ("roomId", "userId"),
        CONSTRAINT "PK_room_members" PRIMARY KEY ("id"),
        CONSTRAINT "FK_room_members_room" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_room_members_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_room_members_roomId" ON "room_members" ("roomId")`);
    await queryRunner.query(`CREATE INDEX "IDX_room_members_userId" ON "room_members" ("userId")`);

    await queryRunner.query(`
      CREATE TABLE "recordings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "roomId" uuid NOT NULL,
        "status" character varying NOT NULL DEFAULT 'starting',
        "filePath" character varying,
        "resolution" character varying NOT NULL DEFAULT '720p',
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "endedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recordings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_recordings_room" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_recordings_roomId" ON "recordings" ("roomId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "recordings"`);
    await queryRunner.query(`DROP TABLE "room_members"`);
    await queryRunner.query(`DROP TABLE "rooms"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
