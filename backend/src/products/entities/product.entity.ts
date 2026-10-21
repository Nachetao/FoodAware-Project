import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { AllergenCode, DietLabel, Nutriscore } from "../contrato/enums";

// Producto del contrato con procedencia y calidad aplanadas en columnas.
// Las listas son text[]: admiten comas dentro de cada valor, a diferencia de simple-array.
// Solo tienen largo máximo los campos que el contrato restringe: el upsert es un
// único INSERT por lote y un valor demasiado largo haría fallar el lote completo.
@Entity("products")
@Check("CHK_products_codigo_barras", `"codigo_barras" ~ '^[0-9]{8,14}$'`)
@Check("CHK_products_nutriscore", `"nutriscore" IN ('a', 'b', 'c', 'd', 'e')`)
export class Product {
  @PrimaryColumn({ type: "varchar", length: 14 })
  codigo_barras: string;

  @Column({ type: "varchar", length: 300 })
  nombre: string;

  @Column({ type: "text", nullable: true })
  marca: string | null;

  @Column({ type: "text", nullable: true })
  cantidad: string | null;

  @Column({ type: "text", nullable: true })
  ingredientes_texto: string | null;

  @Column({ type: "text", array: true })
  ingredientes: string[];

  @Column({ type: "text", array: true })
  alergenos: AllergenCode[];

  @Column({ type: "text", array: true })
  trazas: AllergenCode[];

  @Column({ type: "text", array: true })
  etiquetas_dieta: DietLabel[];

  @Column({ type: "varchar", length: 1, nullable: true })
  nutriscore: Nutriscore | null;

  @Column({ type: "text", nullable: true })
  imagen_url: string | null;

  // Procedencia
  @Column({ type: "varchar", length: 50 })
  fuente: string;

  @Column({ type: "text" })
  url_fuente: string;

  @Column({ type: "timestamptz" })
  recuperado_en: Date;

  @Column({ type: "timestamptz", nullable: true })
  modificado_en_fuente: Date | null;

  @Column({ type: "uuid" })
  run_id: string;

  @Column({ type: "char", length: 64 })
  hash_contenido: string;

  // Calidad
  @Column({ type: "boolean" })
  es_valido: boolean;

  @Column({ type: "text", array: true })
  problemas: string[];

  @Column({ type: "double precision" })
  completitud: number;

  @CreateDateColumn({ type: "timestamptz" })
  creado_en: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  actualizado_en: Date;
}
