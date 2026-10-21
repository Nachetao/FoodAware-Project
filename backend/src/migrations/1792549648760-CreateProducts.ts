import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProducts1792549648760 implements MigrationInterface {
  name = "CreateProducts1792549648760";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "products" ("codigo_barras" character varying(14) NOT NULL, "nombre" character varying(300) NOT NULL, "marca" text, "cantidad" text, "ingredientes_texto" text, "ingredientes" text array NOT NULL, "alergenos" text array NOT NULL, "trazas" text array NOT NULL, "etiquetas_dieta" text array NOT NULL, "nutriscore" character varying(1), "imagen_url" text, "fuente" character varying(50) NOT NULL, "url_fuente" text NOT NULL, "recuperado_en" TIMESTAMP WITH TIME ZONE NOT NULL, "modificado_en_fuente" TIMESTAMP WITH TIME ZONE, "run_id" uuid NOT NULL, "hash_contenido" character(64) NOT NULL, "es_valido" boolean NOT NULL, "problemas" text array NOT NULL, "completitud" double precision NOT NULL, "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_products_nutriscore" CHECK ("nutriscore" IN ('a', 'b', 'c', 'd', 'e')), CONSTRAINT "CHK_products_codigo_barras" CHECK ("codigo_barras" ~ '^[0-9]{8,14}$'), CONSTRAINT "PK_692754aa5a7fafe65a6fa37b7b7" PRIMARY KEY ("codigo_barras"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "products"`);
  }
}
