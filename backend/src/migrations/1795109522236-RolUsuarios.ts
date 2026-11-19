import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * users.rol: "usuario" o "administrador". Los usuarios existentes quedan como
 * "usuario" por el valor por defecto; los administradores se asignan con el
 * script admin:asignar.
 */
export class RolUsuarios1795109522236 implements MigrationInterface {
  name = "RolUsuarios1795109522236";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."rol_usuario" AS ENUM('usuario', 'administrador')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "rol" "public"."rol_usuario" NOT NULL DEFAULT 'usuario'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "rol"`);
    await queryRunner.query(`DROP TYPE "public"."rol_usuario"`);
  }
}
