import { MigrationInterface, QueryRunner } from 'typeorm';

/** A user may have only one unfinished (created or active) owned room. */
export class RoomCurrentOwner1755600000000 implements MigrationInterface {
  name = 'RoomCurrentOwner1755600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rooms_one_active_owner"`);
    // Preserve legacy rooms while resolving pre-existing duplicate unfinished rows.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY "ownerId" ORDER BY "createdAt" DESC) AS rank
        FROM "rooms" WHERE "status" IN ('created', 'active')
      )
      UPDATE "rooms" SET "status" = 'finished'
      WHERE id IN (SELECT id FROM ranked WHERE rank > 1)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_rooms_one_current_owner"
      ON "rooms" ("ownerId")
      WHERE "status" IN ('created', 'active')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rooms_one_current_owner"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_rooms_one_active_owner"
      ON "rooms" ("ownerId") WHERE "status" = 'active'
    `);
  }
}
