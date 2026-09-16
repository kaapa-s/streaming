import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes room lifecycle explicit. Existing rooms are intentionally backfilled as
 * created because the old schema did not record whether a room ever went live.
 */
export class RoomLifecycle1755400000000 implements MigrationInterface {
  name = 'RoomLifecycle1755400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rooms"
      ADD COLUMN IF NOT EXISTS "status" character varying NOT NULL DEFAULT 'created'
    `);
    await queryRunner.query(`
      UPDATE "rooms" SET "status" = 'created' WHERE "status" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_rooms_one_active_owner"
      ON "rooms" ("ownerId")
      WHERE "status" = 'active'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rooms_one_active_owner"`);
    await queryRunner.query(`ALTER TABLE "rooms" DROP COLUMN IF EXISTS "status"`);
  }
}
