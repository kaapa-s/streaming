import { MigrationInterface, QueryRunner } from 'typeorm';

export class RoomNames1755500000000 implements MigrationInterface {
  name = 'RoomNames1755500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rooms"
      ADD COLUMN IF NOT EXISTS "name" character varying
    `);
    await queryRunner.query(`
      UPDATE "rooms" SET "name" = "slug" WHERE "name" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "rooms" ALTER COLUMN "name" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rooms" DROP COLUMN IF EXISTS "name"`);
  }
}
