import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist the raw invite token so the canonical invite URL can be shown again
 * after creation. Legacy hash-only invites get NULL and must be regenerated.
 */
export class RoomInviteToken1756100000000 implements MigrationInterface {
  name = 'RoomInviteToken1756100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "room_invites" ADD "token" character varying`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_room_invites_token" ON "room_invites" ("token")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_room_invites_token"`);
    await queryRunner.query(`ALTER TABLE "room_invites" DROP COLUMN "token"`);
  }
}
