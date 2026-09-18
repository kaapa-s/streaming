import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durable live/recording session state. Adds the go-live flag and destinations
 * (so owner control can be restored after a reconnect) plus a visible failure
 * message, and renames the terminal `stopped` status to `finished`.
 */
export class SessionLifecycle1755900000000 implements MigrationInterface {
  name = 'SessionLifecycle1755900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recordings"
      ADD COLUMN IF NOT EXISTS "live" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "recordings"
      ADD COLUMN IF NOT EXISTS "destinations" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "recordings"
      ADD COLUMN IF NOT EXISTS "error" character varying
    `);
    await queryRunner.query(`
      UPDATE "recordings" SET "status" = 'finished' WHERE "status" = 'stopped'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "recordings" SET "status" = 'stopped' WHERE "status" = 'finished'
    `);
    await queryRunner.query(`ALTER TABLE "recordings" DROP COLUMN IF EXISTS "error"`);
    await queryRunner.query(`ALTER TABLE "recordings" DROP COLUMN IF EXISTS "destinations"`);
    await queryRunner.query(`ALTER TABLE "recordings" DROP COLUMN IF EXISTS "live"`);
  }
}
