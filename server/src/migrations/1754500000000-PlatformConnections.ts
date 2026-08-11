import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformConnections1754500000000 implements MigrationInterface {
  name = 'PlatformConnections1754500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "platform_connections" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "provider" character varying NOT NULL,
        "externalAccountId" character varying NOT NULL,
        "accountLabel" character varying,
        "accessTokenEnc" text NOT NULL,
        "refreshTokenEnc" text,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "scopes" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_platform_connections_user_provider" UNIQUE ("userId", "provider"),
        CONSTRAINT "PK_platform_connections" PRIMARY KEY ("id"),
        CONSTRAINT "FK_platform_connections_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_platform_connections_userId" ON "platform_connections" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_connections"`);
  }
}
