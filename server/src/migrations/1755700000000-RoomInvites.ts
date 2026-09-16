import { MigrationInterface, QueryRunner } from 'typeorm';

export class RoomInvites1755700000000 implements MigrationInterface {
  name = 'RoomInvites1755700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "room_invites" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tokenHash" character varying NOT NULL, "roomId" uuid NOT NULL, "revokedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_room_invites_tokenHash" UNIQUE ("tokenHash"), CONSTRAINT "PK_room_invites" PRIMARY KEY ("id"), CONSTRAINT "FK_room_invites_room" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE)`);
    await queryRunner.query(`CREATE INDEX "IDX_room_invites_roomId" ON "room_invites" ("roomId")`);
    await queryRunner.query(`ALTER TABLE "room_members" ALTER COLUMN "userId" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "room_members" ADD "guestId" character varying`);
    await queryRunner.query(`ALTER TABLE "room_members" ADD "displayName" character varying`);
    await queryRunner.query(`CREATE INDEX "IDX_room_members_guestId" ON "room_members" ("guestId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_room_members_guestId"`);
    await queryRunner.query(`ALTER TABLE "room_members" DROP COLUMN "displayName"`);
    await queryRunner.query(`ALTER TABLE "room_members" DROP COLUMN "guestId"`);
    await queryRunner.query(`ALTER TABLE "room_members" ALTER COLUMN "userId" SET NOT NULL`);
    await queryRunner.query(`DROP INDEX "public"."IDX_room_invites_roomId"`);
    await queryRunner.query(`DROP TABLE "room_invites"`);
  }
}
