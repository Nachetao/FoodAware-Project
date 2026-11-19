import { Injectable, Logger } from "@nestjs/common";
import { ParametrosBusqueda, RespuestaBusqueda } from "./contrato/busqueda";
import { ErrorContrato } from "./contrato/error";
import { Producto } from "./contrato/producto";
import { ContratoHttpException } from "./contrato-http.exception";
import { FastApiClientService } from "./fastapi-client.service";
import { FuenteDatos } from "./fuente-datos";
import { ProductsRepository, ResultadoRespaldo } from "./products.repository";
import { Compatibilidad, TipoVeredicto } from "./dto/compatibilidad.dto";
import { AllergenCode } from "./contrato/enums";
import { UsersService } from "../users/users.service";

// Errores de FastAPI (ya con los reintentos agotados) que usan el respaldo:
// error interno (500), respuesta fuera del contrato (502), sin conexión (503)
// y timeout (504). Nunca los 4xx.
const STATUS_CON_RESPALDO = new Set([500, 502, 503, 504]);

export interface BusquedaProductos {
  respuesta: RespuestaBusqueda;
  fuente: FuenteDatos;
}

export interface DetalleProducto {
  respuesta: Producto;
  fuente: FuenteDatos;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly fastApiClient: FastApiClientService,
    private readonly productsRepository: ProductsRepository,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Compatibilidad del producto con las alergias del usuario. El producto se
   * obtiene igual que el detalle (FastAPI o respaldo). Ver evaluarCompatibilidad.
   */
  async compatibilidad(
    codigoBarras: string,
    usuarioId: string,
    requestId: string,
  ): Promise<{ respuesta: Compatibilidad; fuente: FuenteDatos }> {
    const [{ respuesta: producto, fuente }, { alergias }] = await Promise.all([
      this.obtener(codigoBarras, requestId),
      this.usersService.perfil(usuarioId),
    ]);
    return { respuesta: evaluarCompatibilidad(producto, alergias), fuente };
  }

  /**
   * Productos guardados que coinciden con la búsqueda y no tienen ningún
   * alérgeno del usuario, ni como ingrediente ni como traza ("solo aptos" no
   * muestra productos con advertencia), con la forma de RespuestaBusqueda
   * (estado_fuente "cache": vienen de la base).
   */
  async compatibles(
    params: ParametrosBusqueda,
    usuarioId: string,
  ): Promise<RespuestaBusqueda> {
    const { alergias } = await this.usersService.perfil(usuarioId);
    const inicio = performance.now();
    const { total, resultados } =
      await this.productsRepository.buscarCompatibles(params, alergias);
    return {
      consulta: params.q,
      total,
      tiempo_ms: Math.round((performance.now() - inicio) * 1000) / 1000,
      resultados,
      estado_fuente: "cache",
    };
  }

  /**
   * Busca en FastAPI y guarda los productos encontrados. Si FastAPI falla,
   * responde desde la tabla products con la misma forma del contrato.
   */
  async buscar(
    params: ParametrosBusqueda,
    requestId: string,
  ): Promise<BusquedaProductos> {
    let respuesta: RespuestaBusqueda;
    try {
      respuesta = await this.fastApiClient.buscar(params, requestId);
    } catch (error) {
      return {
        respuesta: await this.buscarEnRespaldo(params, requestId, error),
        fuente: "respaldo",
      };
    }

    await this.guardarSinRomper(
      respuesta.resultados.map((r) => r.producto),
      requestId,
    );
    return { respuesta, fuente: "fastapi" };
  }

  /**
   * Detalle de un producto desde FastAPI, que también se guarda. Si FastAPI
   * falla (500/502/503/504) responde con el producto guardado; un 404 se
   * propaga y, si tampoco está en la base, se mantiene el error original.
   */
  async obtener(
    codigoBarras: string,
    requestId: string,
  ): Promise<DetalleProducto> {
    let producto: Producto;
    try {
      producto = await this.fastApiClient.obtenerProducto(
        codigoBarras,
        requestId,
      );
    } catch (error) {
      return {
        respuesta: await this.obtenerDeRespaldo(codigoBarras, requestId, error),
        fuente: "respaldo",
      };
    }

    await this.guardarSinRomper([producto], requestId);
    return { respuesta: producto, fuente: "fastapi" };
  }

  // Si el guardado falla, se responde igual con los datos de FastAPI.
  private async guardarSinRomper(productos: Producto[], requestId: string) {
    try {
      await this.productsRepository.guardar(productos);
    } catch (error) {
      this.logger.error(
        `[${requestId}] No se pudieron guardar ${productos.length} productos: ${error.message}`,
      );
    }
  }

  private async obtenerDeRespaldo(
    codigoBarras: string,
    requestId: string,
    error: unknown,
  ): Promise<Producto> {
    const falla = this.fallaConRespaldo(error);

    let producto: Producto | null;
    try {
      producto = await this.productsRepository.buscarPorCodigo(codigoBarras);
    } catch (errorBase) {
      this.logger.error(
        `[${requestId}] ${falla} y el respaldo también falló: ${errorBase.message}`,
      );
      throw error;
    }

    if (!producto) {
      this.logger.warn(
        `[${requestId}] ${falla} y el producto ${codigoBarras} no está en la base; se mantiene el error`,
      );
      throw error;
    }

    this.logger.warn(
      `[${requestId}] ${falla}; respondiendo el producto ${codigoBarras} desde la base`,
    );
    return producto;
  }

  /**
   * Describe la falla si corresponde usar el respaldo; si no (4xx o un error
   * que no es del contrato), relanza el error original.
   */
  private fallaConRespaldo(error: unknown): string {
    if (
      !(error instanceof ContratoHttpException) ||
      !STATUS_CON_RESPALDO.has(error.getStatus())
    ) {
      throw error;
    }
    const { codigo } = (error.getResponse() as ErrorContrato).error;
    return `FastAPI falló con ${error.getStatus()} ${codigo}`;
  }

  /**
   * Responde desde la base o, si no corresponde o no hay resultados, relanza
   * el error original de FastAPI.
   */
  private async buscarEnRespaldo(
    params: ParametrosBusqueda,
    requestId: string,
    error: unknown,
  ): Promise<RespuestaBusqueda> {
    const falla = this.fallaConRespaldo(error);
    const inicio = performance.now();

    let resultado: ResultadoRespaldo;
    try {
      resultado = await this.productsRepository.buscarRespaldo(params);
    } catch (errorBase) {
      this.logger.error(
        `[${requestId}] ${falla} y el respaldo también falló: ${errorBase.message}`,
      );
      throw error;
    }

    if (resultado.total === 0) {
      this.logger.warn(
        `[${requestId}] ${falla} y el respaldo no tiene resultados; se mantiene el error`,
      );
      throw error;
    }

    this.logger.warn(
      `[${requestId}] ${falla}; respondiendo desde la base: ${resultado.resultados.length} de ${resultado.total} productos`,
    );
    return {
      consulta: params.q,
      total: resultado.total,
      tiempo_ms: Math.round((performance.now() - inicio) * 1000) / 1000,
      resultados: resultado.resultados,
      estado_fuente: "cache",
    };
  }
}

// Bajo esta completitud los datos no alcanzan para decidir (mismo umbral que
// COMPLETITUD_MINIMA del motor de FastAPI).
const COMPLETITUD_MINIMA = 0.5;
// Problemas de calidad que indican que no hay ingredientes que revisar.
const PROBLEMAS_SIN_INGREDIENTES = new Set([
  "sin_ingredientes",
  "ingredientes_vacios",
]);

/** false si el producto no tiene ingredientes o su completitud es baja. */
export function tieneDatosSuficientes(producto: Producto): boolean {
  const sinIngredientes =
    producto.ingredientes.length === 0 ||
    producto.calidad.problemas.some((p) => PROBLEMAS_SIN_INGREDIENTES.has(p));
  return !sinIngredientes && producto.calidad.completitud >= COMPLETITUD_MINIMA;
}

/**
 * Veredicto local, regla conservadora (filas 1, 3 y 5 del contrato del motor):
 * el error más grave es un falso "apto", así que "apto" se gana.
 * - no_apto: algún alérgeno del producto está en las alergias del usuario.
 * - apto_con_advertencia: solo coinciden trazas, o el usuario tiene alergias
 *   y los datos no alcanzan para confirmar.
 * - apto: nada de lo anterior.
 */
export function evaluarCompatibilidad(
  producto: Producto,
  alergias: AllergenCode[],
): Compatibilidad {
  const delUsuario = new Set(alergias);
  const alergenos_en_conflicto = producto.alergenos.filter((a) =>
    delUsuario.has(a),
  );
  const trazas_en_conflicto = producto.trazas.filter((a) => delUsuario.has(a));
  const datos_suficientes = tieneDatosSuficientes(producto);

  let veredicto: TipoVeredicto = "apto";
  if (alergenos_en_conflicto.length > 0) {
    veredicto = "no_apto";
  } else if (
    trazas_en_conflicto.length > 0 ||
    (delUsuario.size > 0 && !datos_suficientes)
  ) {
    veredicto = "apto_con_advertencia";
  }

  return {
    veredicto,
    apto: veredicto === "apto",
    alergenos_en_conflicto,
    trazas_en_conflicto,
    datos_suficientes,
  };
}
