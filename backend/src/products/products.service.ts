import { Injectable, Logger } from "@nestjs/common";
import { ParametrosBusqueda, RespuestaBusqueda } from "./contrato/busqueda";
import { ErrorContrato } from "./contrato/error";
import { Producto } from "./contrato/producto";
import { ContratoHttpException } from "./contrato-http.exception";
import { FastApiClientService } from "./fastapi-client.service";
import { FuenteDatos } from "./fuente-datos";
import {
  ProductsRepository,
  ResultadoPersonalizadoRespaldo,
  ResultadoRespaldo,
} from "./products.repository";
import { Compatibilidad } from "./dto/compatibilidad.dto";
import { BusquedaPersonalizada } from "./dto/busqueda-personalizada.dto";
import {
  ModoBusqueda,
  PerfilRestricciones,
  RespuestaBusquedaPersonalizada,
} from "./contrato/adaptativo";
import {
  AVISO,
  textoNoAptos,
  veredictoDeRespaldo,
} from "./compatibilidad-local";
import { tokensRespaldo } from "./busqueda-respaldo";
import { UsersService, UsuarioPublico } from "../users/users.service";

// Errores de FastAPI (ya con los reintentos agotados) que usan el respaldo:
// error interno (500), respuesta fuera del contrato (502), sin conexión (503)
// y timeout (504). Nunca los 4xx.
const STATUS_CON_RESPALDO = new Set([500, 502, 503, 504]);

/**
 * Páginas extra que /compatibles pide como máximo al motor para contar los
 * "apto" (el total). Si se alcanza, el total es lo contado hasta ahí.
 */
export const MAX_PAGINAS_TOTAL_COMPATIBLES = 5;
// Límite máximo de una página del motor (contrato de /search/personalized).
const LIMITE_MOTOR = 50;

export interface BusquedaProductos {
  respuesta: RespuestaBusqueda;
  fuente: FuenteDatos;
}

export interface BusquedaPersonalizadaConFuente {
  respuesta: BusquedaPersonalizada;
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
   * Veredicto del motor adaptativo para el perfil del usuario. Si el motor
   * falla (500, 502, 503 o 504 tras los reintentos), responde con la regla
   * local sobre el producto guardado, que nunca es "apto". Un 404 se propaga.
   */
  async compatibilidad(
    codigoBarras: string,
    usuarioId: string,
    requestId: string,
  ): Promise<{ respuesta: Compatibilidad; fuente: FuenteDatos }> {
    const perfil = perfilDe(await this.usersService.perfil(usuarioId));
    try {
      const veredicto = await this.fastApiClient.compatibilidad(
        codigoBarras,
        perfil,
        requestId,
      );
      return {
        respuesta: { ...veredicto, apto: veredicto.veredicto === "apto" },
        fuente: "fastapi",
      };
    } catch (error) {
      const producto = await this.obtenerDeRespaldo(
        codigoBarras,
        requestId,
        error,
      );
      // En respaldo veredicto nunca es "apto", así que apto siempre es false.
      const veredicto = veredictoDeRespaldo(producto, perfil);
      return {
        respuesta: { ...veredicto, apto: veredicto.veredicto === "apto" },
        fuente: "respaldo",
      };
    }
  }

  /**
   * Búsqueda personalizada del motor adaptativo con el perfil del usuario.
   * Guarda los productos encontrados. Si el motor falla (500, 502, 503 o
   * 504), ordena las coincidencias guardadas con la regla local; si la base
   * tampoco tiene coincidencias, se mantiene el error.
   */
  async buscarPersonalizado(
    params: ParametrosBusqueda,
    modo: ModoBusqueda,
    usuarioId: string,
    requestId: string,
  ): Promise<BusquedaPersonalizadaConFuente> {
    const perfil = perfilDe(await this.usersService.perfil(usuarioId));
    try {
      const respuesta = await this.fastApiClient.buscarPersonalizado(
        { consulta: params.q, perfil, modo, ...paginacion(params) },
        requestId,
      );
      await this.guardarSinRomper(
        respuesta.resultados.map((r) => r.producto),
        requestId,
      );
      return { respuesta, fuente: "fastapi" };
    } catch (error) {
      return {
        respuesta: await this.personalizadoEnRespaldo(
          params,
          modo,
          perfil,
          requestId,
          error,
        ),
        fuente: "respaldo",
      };
    }
  }

  /**
   * "Solo aptos para mí": la búsqueda personalizada en modo filtrar y con
   * modo estricto (solo en esta llamada), así las trazas y los datos
   * insuficientes también quedan ocultos. Responde con la forma de
   * RespuestaBusqueda. Si el motor falla, busca en los productos guardados
   * con la misma regla.
   *
   * Filtrar oculta los no_apto, pero con dietas también llegan los
   * apto_con_advertencia (una dieta que el producto no declara lo es incluso
   * en modo estricto). Como el motor ordena los apto primero, se muestran solo
   * los apto y total se cuenta hasta el primero que no lo es.
   */
  async compatibles(
    params: ParametrosBusqueda,
    usuarioId: string,
    requestId: string,
  ): Promise<BusquedaProductos> {
    const perfil: PerfilRestricciones = {
      ...perfilDe(await this.usersService.perfil(usuarioId)),
      modo_estricto: true,
    };
    let respuesta: BusquedaPersonalizada;
    try {
      respuesta = await this.paginaCompatibles(
        params.q,
        perfil,
        params.offset,
        params.limit,
        requestId,
      );
    } catch (error) {
      return {
        respuesta: await this.compatiblesEnRespaldo(
          params,
          perfil,
          requestId,
          error,
        ),
        fuente: "respaldo",
      };
    }

    await this.guardarSinRomper(
      respuesta.resultados.map((r) => r.producto),
      requestId,
    );
    const aptos = respuesta.resultados.filter(
      (r) => r.veredicto.veredicto === "apto",
    );
    return {
      respuesta: {
        consulta: params.q,
        total: await this.totalCompatibles(
          params,
          perfil,
          respuesta,
          requestId,
        ),
        tiempo_ms: respuesta.tiempo_ms,
        resultados: aptos.map(({ producto, score, posicion }) => ({
          producto,
          score,
          posicion,
        })),
        estado_fuente: respuesta.estado_fuente,
      },
      fuente: "fastapi",
    };
  }

  private paginaCompatibles(
    consulta: string,
    perfil: PerfilRestricciones,
    offset: number,
    limit: number,
    requestId: string,
  ): Promise<RespuestaBusquedaPersonalizada> {
    return this.fastApiClient.buscarPersonalizado(
      { consulta, perfil, modo: "filtrar", limit, offset },
      requestId,
    );
  }

  /**
   * Cuántos "apto" hay en total. Los apto van primero en el ranking del
   * motor: si la página ya muestra dónde terminan, no hace falta pedir más;
   * si no, se siguen pidiendo páginas (como máximo
   * MAX_PAGINAS_TOTAL_COMPATIBLES).
   */
  private async totalCompatibles(
    { q, offset }: ParametrosBusqueda,
    perfil: PerfilRestricciones,
    pagina: BusquedaPersonalizada,
    requestId: string,
  ): Promise<number> {
    const aptos = aptosAlInicio(pagina);
    const vistos = offset + pagina.resultados.length;
    const terminan = aptos < pagina.resultados.length || vistos >= pagina.total;
    if (aptos > 0 && terminan) {
      return offset + aptos;
    }
    if (aptos === 0 && offset === 0) {
      return 0;
    }
    // Página llena de apto: se sigue contando desde su final. Página sin
    // apto con offset: los apto terminaron antes; se cuentan desde el inicio.
    return this.contarAptos(q, perfil, aptos > 0 ? vistos : 0, requestId);
  }

  private async contarAptos(
    consulta: string,
    perfil: PerfilRestricciones,
    desde: number,
    requestId: string,
  ): Promise<number> {
    let contados = desde;
    for (let i = 0; i < MAX_PAGINAS_TOTAL_COMPATIBLES; i++) {
      let pagina: BusquedaPersonalizada;
      try {
        pagina = await this.paginaCompatibles(
          consulta,
          perfil,
          contados,
          LIMITE_MOTOR,
          requestId,
        );
      } catch (error) {
        this.logger.warn(
          `[${requestId}] /compatibles no pudo contar todos los apto (${error.message}); total es al menos ${contados}`,
        );
        return contados;
      }
      const aptos = aptosAlInicio(pagina);
      contados += aptos;
      if (
        aptos < pagina.resultados.length ||
        pagina.resultados.length === 0 ||
        contados >= pagina.total
      ) {
        return contados;
      }
    }
    this.logger.warn(
      `[${requestId}] /compatibles alcanzó el tope de ${MAX_PAGINAS_TOTAL_COMPATIBLES} páginas al contar los apto; total es al menos ${contados}`,
    );
    return contados;
  }

  /**
   * Respaldo de /compatibles: productos guardados que son "apto" para el
   * perfil en modo estricto, con la regla local.
   */
  private async compatiblesEnRespaldo(
    params: ParametrosBusqueda,
    perfil: PerfilRestricciones,
    requestId: string,
    error: unknown,
  ): Promise<RespuestaBusqueda> {
    const falla = this.fallaConRespaldo(error);
    const inicio = performance.now();
    let resultado: ResultadoRespaldo;
    try {
      resultado = await this.productsRepository.buscarCompatibles(
        params,
        perfil,
      );
    } catch (errorBase) {
      this.logger.error(
        `[${requestId}] ${falla} y el respaldo de /compatibles también falló: ${errorBase.message}`,
      );
      throw error;
    }
    this.logger.warn(
      `[${requestId}] ${falla}; /compatibles responde desde la base: ${resultado.resultados.length} de ${resultado.total} productos`,
    );
    return {
      consulta: params.q,
      total: resultado.total,
      tiempo_ms: msDesde(inicio),
      resultados: resultado.resultados,
      estado_fuente: "cache",
    };
  }

  /**
   * Respaldo de la búsqueda personalizada: coincidencias guardadas con el
   * veredicto de la regla local (nunca "apto"). No interpreta restricciones
   * de la consulta ("sin leche") ni compara con el ranking base.
   */
  private async personalizadoEnRespaldo(
    params: ParametrosBusqueda,
    modo: ModoBusqueda,
    perfil: PerfilRestricciones,
    requestId: string,
    error: unknown,
  ): Promise<BusquedaPersonalizada> {
    const falla = this.fallaConRespaldo(error);
    const inicio = performance.now();

    let resultado: ResultadoPersonalizadoRespaldo;
    try {
      resultado = await this.productsRepository.buscarPersonalizadoRespaldo(
        params,
        perfil,
        modo,
      );
    } catch (errorBase) {
      this.logger.error(
        `[${requestId}] ${falla} y el respaldo de la búsqueda personalizada también falló: ${errorBase.message}`,
      );
      throw error;
    }

    if (resultado.total_base === 0) {
      this.logger.warn(
        `[${requestId}] ${falla} y el respaldo no tiene coincidencias; se mantiene el error`,
      );
      throw error;
    }

    this.logger.warn(
      `[${requestId}] ${falla}; búsqueda personalizada desde la base: ${resultado.resultados.length} de ${resultado.total} productos`,
    );
    const ocultos = modo === "filtrar";
    return {
      consulta: params.q,
      interpretacion: {
        terminos: tokensRespaldo(params.q),
        restricciones: [],
        no_reconocidas: [],
      },
      perfil_aplicado: perfil,
      modo,
      total: resultado.total,
      total_base: resultado.total_base,
      tiempo_ms: msDesde(inicio),
      estado_fuente: "cache",
      resultados: resultado.resultados.map(({ producto, score, posicion }) => ({
        producto,
        score,
        posicion,
        posicion_base: null,
        veredicto: veredictoDeRespaldo(producto, perfil),
      })),
      no_aptos: {
        total: resultado.no_aptos,
        ocultos,
        motivos: resultado.motivos.map(({ tipo, codigo, cantidad }) => ({
          tipo,
          codigo,
          cantidad,
        })),
        texto: textoNoAptos(resultado.no_aptos, resultado.motivos, ocultos),
      },
      comparacion: null,
      aviso: AVISO,
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

/**
 * Perfil para el motor: solo las restricciones del usuario (alergias, dietas
 * y modo estricto), nunca su id, nombre, correo ni rol.
 */
export function perfilDe({
  alergias,
  dietas,
  modo_estricto,
}: Pick<
  UsuarioPublico,
  "alergias" | "dietas" | "modo_estricto"
>): PerfilRestricciones {
  return { alergias, dietas, modo_estricto };
}

/** Cuántos resultados seguidos son "apto" desde el inicio de la página. */
function aptosAlInicio({ resultados }: BusquedaPersonalizada): number {
  const primero = resultados.findIndex((r) => r.veredicto.veredicto !== "apto");
  return primero === -1 ? resultados.length : primero;
}

function paginacion({ limit, offset }: ParametrosBusqueda) {
  return { limit, offset };
}

function msDesde(inicio: number): number {
  return Math.round((performance.now() - inicio) * 1000) / 1000;
}
