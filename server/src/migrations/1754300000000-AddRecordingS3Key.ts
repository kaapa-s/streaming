import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordingS3Key1754300000000 implements MigrationInterface {
  name = 'AddRecordingS3Key1754300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recordings"
      ADD COLUMN "s3Key" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "recordings" DROP COLUMN "s3Key"`);
  }
}
