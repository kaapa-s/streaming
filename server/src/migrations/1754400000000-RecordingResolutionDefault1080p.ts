import { MigrationInterface, QueryRunner } from 'typeorm';

export class RecordingResolutionDefault1080p1754400000000 implements MigrationInterface {
  name = 'RecordingResolutionDefault1080p1754400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recordings" ALTER COLUMN "resolution" SET DEFAULT '1080p'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recordings" ALTER COLUMN "resolution" SET DEFAULT '720p'`,
    );
  }
}
