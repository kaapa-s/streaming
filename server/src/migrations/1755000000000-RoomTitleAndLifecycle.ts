import { MigrationInterface, QueryRunner } from 'typeorm';

export class RoomTitleAndLifecycle1755000000000 implements MigrationInterface {
  name = 'RoomTitleAndLifecycle1755000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rooms" ADD "title" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(`ALTER TABLE "rooms" ADD "closedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`UPDATE "rooms" SET "title" = "slug" WHERE "title" = ''`);
    // Rooms are now one-per-stream and ephemeral. Every pre-existing room
    // ("main", the e2e-* rooms) predates that model, so retire them rather than
    // leaving guessable slugs joinable forever.
    await queryRunner.query(`UPDATE "rooms" SET "closedAt" = now() WHERE "closedAt" IS NULL`);
    await queryRunner.query(
      `CREATE INDEX "IDX_rooms_closedAt" ON "rooms" ("closedAt")`,
    );

    await queryRunner.query(
      `ALTER TABLE "room_members" ADD "removedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "room_members" ADD "removedById" uuid`);
    await queryRunner.query(
      `ALTER TABLE "room_members" ADD CONSTRAINT "FK_room_members_removed_by" ` +
        `FOREIGN KEY ("removedById") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "room_members" DROP CONSTRAINT "FK_room_members_removed_by"`,
    );
    await queryRunner.query(`ALTER TABLE "room_members" DROP COLUMN "removedById"`);
    await queryRunner.query(`ALTER TABLE "room_members" DROP COLUMN "removedAt"`);
    await queryRunner.query(`DROP INDEX "IDX_rooms_closedAt"`);
    await queryRunner.query(`ALTER TABLE "rooms" DROP COLUMN "closedAt"`);
    await queryRunner.query(`ALTER TABLE "rooms" DROP COLUMN "title"`);
  }
}
