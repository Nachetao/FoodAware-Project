import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { AppModule } from "../../src/app.module";
import { configurarApp } from "../../src/config/configurar-app";
import { tokensRespaldo } from "../../src/products/busqueda-respaldo";
import {
  ParametrosBusqueda,
  RespuestaBusqueda,
} from "../../src/products/contrato/busqueda";
import { Producto } from "../../src/products/contrato/producto";
import { Product } from "../../src/products/entities/product.entity";
import { ResultadoRespaldo } from "../../src/products/products.repository";
import { ProductsRepository } from "../../src/products/products.repository";
import { User } from "../../src/users/user.entity";
import { AllergenCode } from "../../src/products/contrato/enums";
import { Food } from "../../src/foods/entities/food.entity";

/**
 * Sustituto en memoria de ProductsRepository: guarda por codigo_barras (sin
 * duplicados) y busca por nombre con los mismos tokens que el respaldo real.
 */
export class ProductosEnMemoria implements Pick<
  ProductsRepository,
  "guardar" | "buscarRespaldo" | "buscarPorCodigo" | "buscarCompatibles"
> {
  readonly productos = new Map<string, Producto>();

  async buscarPorCodigo(codigoBarras: string): Promise<Producto | null> {
    return this.productos.get(codigoBarras) ?? null;
  }

  async guardar(productos: Producto[]): Promise<void> {
    for (const producto of productos) {
      this.productos.set(producto.codigo_barras, producto);
    }
  }

  async buscarCompatibles(
    params: ParametrosBusqueda,
    alergias: AllergenCode[],
  ): Promise<ResultadoRespaldo> {
    const excluir = new Set<string>(alergias);
    const todos = await this.buscarRespaldo({ ...params, limit: 1000, offset: 0 });
    const compatibles = todos.resultados.filter(
      (r) => !r.producto.alergenos.some((a) => excluir.has(a)),
    );
    return {
      total: compatibles.length,
      resultados: compatibles
        .slice(params.offset, params.offset + params.limit)
        .map((r, i) => ({ ...r, posicion: params.offset + i + 1 })),
    };
  }

  async buscarRespaldo({
    q,
    limit,
    offset,
  }: ParametrosBusqueda): Promise<ResultadoRespaldo> {
    const tokens = tokensRespaldo(q);
    const coincidencias = [...this.productos.values()]
      .map((producto) => ({
        producto,
        score: tokens.filter((t) => producto.nombre.toLowerCase().includes(t))
          .length,
      }))
      .filter(({ score }) => score > 0);
    return {
      total: coincidencias.length,
      resultados: coincidencias
        .slice(offset, offset + limit)
        .map((r, i) => ({ ...r, posicion: offset + i + 1 })),
    };
  }
}

/** Repositorio de usuarios en memoria (findOne por id o correo, save). */
export class UsuariosEnMemoria {
  readonly usuarios = new Map<string, User>();

  async findOne({ where }: { where: Partial<User> }): Promise<User | null> {
    return (
      [...this.usuarios.values()].find((u) =>
        Object.entries(where).every(([k, v]) => u[k as keyof User] === v),
      ) ?? null
    );
  }

  create(datos: Partial<User>): User {
    return { ...datos } as User;
  }

  async save(usuario: User): Promise<User> {
    const guardado = { ...usuario, id: usuario.id ?? `usuario-${this.usuarios.size + 1}` };
    this.usuarios.set(guardado.id, guardado);
    return guardado;
  }
}

/** DataSource falso: solo lo usa /api/health (SELECT 1). */
export class BaseDeDatosFalsa {
  caida = false;
  readonly isInitialized = false;

  async query(): Promise<unknown> {
    if (this.caida) throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    return [{ "?column?": 1 }];
  }

  async destroy(): Promise<void> {}
}

/**
 * Levanta el AppModule real (guard JWT, interceptor, filtros y la misma
 * configuración que main.ts) sin PostgreSQL: la base y los repositorios se
 * reemplazan por sustitutos.
 */
export async function crearApp(pythonApiUrl: string) {
  process.env.PYTHON_API_URL = pythonApiUrl;
  const productos = new ProductosEnMemoria();
  const base = new BaseDeDatosFalsa();
  const usuarios = new UsuariosEnMemoria();

  const modulo = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(base)
    .overrideProvider(getRepositoryToken(Product))
    .useValue({})
    .overrideProvider(getRepositoryToken(User))
    .useValue(usuarios)
    .overrideProvider(getRepositoryToken(Food))
    .useValue({})
    .overrideProvider(ProductsRepository)
    .useValue(productos)
    .compile();

  const app: INestApplication = modulo.createNestApplication({
    bufferLogs: true,
  });
  configurarApp(app);
  await app.init();
  return { app, productos, base, usuarios };
}

/** Producto con la forma exacta del contrato. */
export function producto(codigo_barras: string, nombre: string): Producto {
  return {
    codigo_barras,
    nombre,
    marca: "Colun",
    cantidad: "1 L",
    ingredientes_texto: "Leche semidescremada, vitaminas A y D3.",
    ingredientes: ["leche semidescremada", "vitaminas a y d3"],
    alergenos: ["lacteos"] as Producto["alergenos"],
    trazas: [],
    etiquetas_dieta: [],
    nutriscore: "b",
    imagen_url: null,
    procedencia: {
      fuente: "openfoodfacts",
      url_fuente: `https://world.openfoodfacts.org/product/${codigo_barras}`,
      recuperado_en: "2026-10-20T14:30:00Z",
      modificado_en_fuente: null,
      run_id: "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b",
      hash_contenido: "a".repeat(64),
    },
    calidad: { es_valido: true, problemas: [], completitud: 1 },
  };
}

export function respuestaBusqueda(productos: Producto[]): RespuestaBusqueda {
  return {
    consulta: "leche",
    total: productos.length,
    tiempo_ms: 1.5,
    estado_fuente: "online",
    resultados: productos.map((p, i) => ({
      producto: p,
      score: 10 - i,
      posicion: i + 1,
    })),
  };
}

export function errorContrato(codigo: string, mensaje: string) {
  return { error: { codigo, mensaje, request_id: "id-de-fastapi" } };
}
