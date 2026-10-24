import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Índices de products para las consultas por alérgenos, trazas y dieta, y
 * para el filtro es_valido. Declarados en Product con synchronize: false.
 */
export class IndicesProductos1792811384613 implements MigrationInterface {
  name = "IndicesProductos1792811384613";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // GIN: "no contiene ninguno de estos alérgenos" (alergenos && $1) sin
    // recorrer la tabla; base de GET /api/products/compatibles.
    await queryRunner.query(
      `CREATE INDEX "IDX_products_alergenos_gin" ON "products" USING GIN ("alergenos")`,
    );
    // GIN: lo mismo para las trazas ("puede contener").
    await queryRunner.query(
      `CREATE INDEX "IDX_products_trazas_gin" ON "products" USING GIN ("trazas")`,
    );
    // GIN: filtrar por dieta (etiquetas_dieta @> ARRAY['vegano']).
    await queryRunner.query(
      `CREATE INDEX "IDX_products_etiquetas_dieta_gin" ON "products" USING GIN ("etiquetas_dieta")`,
    );
    // Parcial: solo filas válidas, que son las que buscan el respaldo y los
    // compatibles (WHERE es_valido), con el desempate del ranking.
    await queryRunner.query(
      `CREATE INDEX "IDX_products_validos" ON "products" ("completitud" DESC, "codigo_barras") WHERE "es_valido"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_products_validos"`);
    await queryRunner.query(`DROP INDEX "IDX_products_etiquetas_dieta_gin"`);
    await queryRunner.query(`DROP INDEX "IDX_products_trazas_gin"`);
    await queryRunner.query(`DROP INDEX "IDX_products_alergenos_gin"`);
  }
}
