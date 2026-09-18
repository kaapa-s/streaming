import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Room-scoped blocklist for kicked members. Enforced by the API on every
 * admit/join path so a room-scoped ban survives the deleted membership row.
 */
export class RoomBlocks1756000000000 implements MigrationInterface {
  name = 'RoomBlocks1756000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "room_blocks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "roomId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_room_blocks_room_user" UNIQUE ("roomId", "userId"),
        CONSTRAINT "PK_room_blocks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_room_blocks_room" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_room_blocks_roomId" ON "room_blocks" ("roomId")`);
    await queryRunner.query(`CREATE INDEX "IDX_room_blocks_userId" ON "room_blocks" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_room_blocks_userId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_room_blocks_roomId"`);
    await queryRunner.query(`DROP TABLE "room_blocks"`);
  }
}
