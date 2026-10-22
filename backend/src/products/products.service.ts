import { Injectable, Logger } from "@nestjs/common";
import { ParametrosBusqueda, RespuestaBusqueda } from "./contrato/busqueda";
import { ErrorContrato } from "./contrato/error";
import { ContratoHttpException } from "./contrato-http.exception";
import { FastApiClientService } from "./fastapi-client.service";
import { FuenteDatos } from "./fuente-datos";
import { ProductsRepository, ResultadoRespaldo } from "./products.repository";

// Errores de FastAPI (ya con los reintentos agotados) que usan el respaldo:
// error interno (500), respuesta fuera del contrato (502), sin conexión (503)
// y timeout (504). Nunca los 4xx.
const STATUS_CON_RESPALDO = new Set([500, 502, 503, 504]);

export interface BusquedaProductos {
  respuesta: RespuestaBusqueda;
  fuente: FuenteDatos;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly fastApiClient: FastApiClientService,
    private readonly productsRepository: ProductsRepository,
  ) {}

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

    const productos = respuesta.resultados.map((r) => r.producto);
    // Si el guardado falla, la búsqueda igual responde con los datos de FastAPI.
    try {
      await this.productsRepository.guardar(productos);
    } catch (error) {
      this.logger.error(
        `[${requestId}] No se pudieron guardar ${productos.length} productos: ${error.message}`,
      );
    }

    return { respuesta, fuente: "fastapi" };
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
    if (
      !(error instanceof ContratoHttpException) ||
      !STATUS_CON_RESPALDO.has(error.getStatus())
    ) {
      throw error;
    }

    const { codigo } = (error.getResponse() as ErrorContrato).error;
    const falla = `FastAPI falló con ${error.getStatus()} ${codigo}`;
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
