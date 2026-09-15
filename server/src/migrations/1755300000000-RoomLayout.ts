import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The room scene now lives on the server, so speakers who join after the owner
 * picked a layout can mirror it instead of defaulting to "just me".
 */
export class RoomLayout1755300000000 implements MigrationInterface {
  name = 'RoomLayout1755300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rooms"
      ADD COLUMN IF NOT EXISTS "layout" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rooms" DROP COLUMN IF EXISTS "layout"`);
  }
}
