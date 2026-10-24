import { MigrationInterface, QueryRunner } from "typeorm";

// Variantes conocidas → código del contrato (misma tabla que
// src/users/alergias.ts, copiada para que la migración no dependa del código).
const SINONIMOS: Array<[string, string]> = [
  ["lacteos", "lacteos"],
  ["lacteo", "lacteos"],
  ["leche", "lacteos"],
  ["lactosa", "lacteos"],
  ["gluten", "gluten"],
  ["trigo", "gluten"],
  ["huevo", "huevo"],
  ["huevos", "huevo"],
  ["mani", "mani"],
  ["manies", "mani"],
  ["cacahuete", "mani"],
  ["cacahuate", "mani"],
  ["frutos secos", "frutos_secos"],
  ["fruto seco", "frutos_secos"],
  ["nueces", "frutos_secos"],
  ["soya", "soya"],
  ["soja", "soya"],
  ["pescado", "pescado"],
  ["pescados", "pescado"],
  ["crustaceos", "crustaceos"],
  ["crustaceo", "crustaceos"],
  ["moluscos", "moluscos"],
  ["molusco", "moluscos"],
  ["sesamo", "sesamo"],
  ["ajonjoli", "sesamo"],
  ["mostaza", "mostaza"],
  ["apio", "apio"],
  ["sulfitos", "sulfitos"],
  ["sulfito", "sulfitos"],
  ["altramuces", "altramuces"],
  ["altramuz", "altramuces"],
  ["lupino", "altramuces"],
];

/**
 * users.alergias: de simple-array (texto separado por comas, valores libres) a
 * text[] NOT NULL con códigos AllergenCode. Normaliza cada valor (minúsculas,
 * sin tildes, "_" como espacio), lo mapea con SINONIMOS y descarta lo que no
 * se reconoce.
 */
export class AlergiasUsuarioConCodigos1792810920922 implements MigrationInterface {
  name = "AlergiasUsuarioConCodigos1792810920922";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const valores = SINONIMOS.map(([v, c]) => `('${v}', '${c}')`).join(", ");

    await queryRunner.query(
      `ALTER TABLE "users" ADD "alergias_codigos" text array NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(`
      WITH sinonimos(variante, codigo) AS (VALUES ${valores}),
      convertidas AS (
        SELECT u.id,
               coalesce(
                 array_agg(DISTINCT s.codigo ORDER BY s.codigo)
                   FILTER (WHERE s.codigo IS NOT NULL),
                 '{}'
               ) AS codigos
        FROM "users" u
        LEFT JOIN LATERAL unnest(string_to_array(coalesce(u.alergias, ''), ',')) AS a(texto) ON true
        LEFT JOIN sinonimos s
          ON s.variante = trim(regexp_replace(
               translate(lower(a.texto), 'áéíóúüñ', 'aeiouun'), '[_[:space:]]+', ' ', 'g'))
        GROUP BY u.id
      )
      UPDATE "users" u SET "alergias_codigos" = c.codigos
      FROM convertidas c WHERE c.id = u.id`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "alergias"`);
    await queryRunner.query(
      `ALTER TABLE "users" RENAME COLUMN "alergias_codigos" TO "alergias"`,
    );
  }

  // Vuelve a simple-array con los códigos; las variantes originales no se recuperan.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "alergias_texto" text`);
    await queryRunner.query(
      `UPDATE "users" SET "alergias_texto" = NULLIF(array_to_string("alergias", ','), '')`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "alergias"`);
    await queryRunner.query(
      `ALTER TABLE "users" RENAME COLUMN "alergias_texto" TO "alergias"`,
    );
  }
}
