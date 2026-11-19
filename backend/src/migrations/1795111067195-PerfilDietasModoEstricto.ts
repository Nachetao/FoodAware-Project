import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * users.dietas (códigos DietLabel) y users.modo_estricto. Compatible hacia
 * atrás: los usuarios existentes quedan sin dietas y sin modo estricto, que
 * es lo que el backend enviaba al motor hasta ahora.
 */
export class PerfilDietasModoEstricto1795111067195 implements MigrationInterface {
  name = "PerfilDietasModoEstricto1795111067195";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "dietas" text array NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "modo_estricto" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "modo_estricto"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "dietas"`);
  }
}
