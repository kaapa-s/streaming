import { MigrationInterface, QueryRunner } from 'typeorm';

export class SceneMembership1755800000000 implements MigrationInterface {
  name = 'SceneMembership1755800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "room_members" ADD "inScene" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`UPDATE "room_members" SET "inScene" = true WHERE "role" = 'owner'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "room_members" DROP COLUMN "inScene"`);
  }
}
