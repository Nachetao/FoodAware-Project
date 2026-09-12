import { MigrationInterface, QueryRunner } from "typeorm";

export class AuthSchema1789173637006 implements MigrationInterface {
    name = 'AuthSchema1789173637006'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nombre" text NOT NULL, "correo" text NOT NULL, "password" text NOT NULL, "alergias" text, CONSTRAINT "UQ_d3cf8c651c0e94ea522b61ca3ac" UNIQUE ("correo"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "foods" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nombre" text NOT NULL, "ingredientes" text NOT NULL, "alergenosPresentes" text, "esNutricionalmenteSaludable" boolean NOT NULL, CONSTRAINT "PK_0cc83421325632f61fa27a52b59" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "foods"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
