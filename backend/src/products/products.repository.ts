import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Producto } from "./contrato/producto";
import { Product } from "./entities/product.entity";
import { aFilaProducto, FilaProducto } from "./producto.mapper";

@Injectable()
export class ProductsRepository {
  constructor(
    @InjectRepository(Product)
    private readonly repository: Repository<Product>,
  ) {}

  /**
   * Inserta o actualiza los productos por codigo_barras en un solo INSERT.
   * Una fila existente solo se actualiza si el dato entrante no es más
   * antiguo (recuperado_en), para no pisar datos nuevos con datos en caché.
   */
  async guardar(productos: Producto[]): Promise<void> {
    const filas = this.sinRepetidos(productos.map(aFilaProducto));
    if (filas.length === 0) {
      return;
    }

    const qb = this.repository.createQueryBuilder().insert().values(filas);
    const tabla = qb.escape(qb.alias);
    // actualizado_en no va en la lista: TypeORM lo actualiza solo (= DEFAULT).
    const columnas = this.repository.metadata.columns
      .filter((c) => !c.isPrimary && !c.isCreateDate && !c.isUpdateDate)
      .map((c) => c.databaseName);

    await qb
      .orUpdate(columnas, ["codigo_barras"], {
        overwriteCondition: {
          where: `EXCLUDED."recuperado_en" >= ${tabla}."recuperado_en"`,
        },
      })
      .updateEntity(false)
      .execute();
  }

  // Postgres rechaza un ON CONFLICT DO UPDATE que toca la misma fila dos veces
  // en un INSERT; si un código se repite, se queda el dato más reciente.
  private sinRepetidos(filas: FilaProducto[]): FilaProducto[] {
    const porCodigo = new Map<string, FilaProducto>();
    for (const fila of filas) {
      const actual = porCodigo.get(fila.codigo_barras);
      if (!actual || fila.recuperado_en >= actual.recuperado_en) {
        porCodigo.set(fila.codigo_barras, fila);
      }
    }
    return [...porCodigo.values()];
  }
}
