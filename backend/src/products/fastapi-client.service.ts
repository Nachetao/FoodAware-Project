import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { AxiosError, isAxiosError } from "axios";
import { firstValueFrom, retry, throwError, timer } from "rxjs";
import { ParametrosBusqueda, RespuestaBusqueda } from "./contrato/busqueda";
import { Producto } from "./contrato/producto";
import {
  MetricasCalidad,
  MetricasEvaluacion,
  ResumenIngesta,
} from "./contrato/metricas";
import { CodigoError } from "./contrato/enums";
import { esErrorContrato } from "./contrato/error";
import {
  PerfilRestricciones,
  RespuestaBusquedaPersonalizada,
  SolicitudBusquedaPersonalizada,
  Veredicto,
} from "./contrato/adaptativo";
import { ContratoHttpException } from "./contrato-http.exception";
import {
  REINTENTOS_FASTAPI_POR_DEFECTO,
  headersFastApi,
  leerEntero,
} from "./fastapi.config";

// Códigos de axios cuando se supera el timeout del HttpModule.
const CODIGOS_TIMEOUT = new Set(["ECONNABORTED", "ETIMEDOUT"]);
// Respuestas de FastAPI que pueden resolverse solas al reintentar.
// El 500 no está: es un error del propio servicio y se repetiría.
const STATUS_TRANSITORIOS = new Set([502, 503, 504]);
// Espera antes del reintento n: BACKOFF_BASE_MS · 2^(n-1) + jitter aleatorio.
const BACKOFF_BASE_MS = 250;
const JITTER_MAX_MS = 100;

type Metodo = "GET" | "POST";

interface OpcionesPeticion {
  params?: Record<string, unknown>;
  cuerpo?: unknown;
}

@Injectable()
export class FastApiClientService {
  private readonly logger = new Logger(FastApiClientService.name);
  private readonly pythonApiUrl: string;
  private readonly reintentos: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.pythonApiUrl = this.configService.get<string>(
      "PYTHON_API_URL",
      "http://localhost:8000",
    );
    this.reintentos = leerEntero(
      this.configService,
      "PYTHON_API_REINTENTOS",
      REINTENTOS_FASTAPI_POR_DEFECTO,
    );
  }

  async buscar(
    { q, limit, offset }: ParametrosBusqueda,
    requestId: string,
  ): Promise<RespuestaBusqueda> {
    return this.get<RespuestaBusqueda>("/search", requestId, {
      q,
      limit,
      offset,
    });
  }

  /** 404 NOT_FOUND (del contrato) si el producto no existe en la fuente. */
  obtenerProducto(codigoBarras: string, requestId: string): Promise<Producto> {
    return this.get<Producto>(
      `/products/${encodeURIComponent(codigoBarras)}`,
      requestId,
    );
  }

  metricasCalidad(requestId: string): Promise<MetricasCalidad> {
    return this.get<MetricasCalidad>("/metrics/quality", requestId);
  }

  metricasEvaluacion(requestId: string): Promise<MetricasEvaluacion> {
    return this.get<MetricasEvaluacion>("/metrics/evaluation", requestId);
  }

  /** 404 NOT_FOUND (del contrato) si todavía no hay ninguna ingesta. */
  ultimaIngesta(requestId: string): Promise<ResumenIngesta> {
    return this.get<ResumenIngesta>("/ingest/runs/latest", requestId);
  }

  /**
   * Veredicto del motor adaptativo. Solo se envía el perfil, nunca la
   * identidad del usuario. Mismos 404, 503 y 504 que obtenerProducto.
   */
  compatibilidad(
    codigoBarras: string,
    perfil: PerfilRestricciones,
    requestId: string,
  ): Promise<Veredicto> {
    return this.pedir<Veredicto>(
      "POST",
      `/products/${encodeURIComponent(codigoBarras)}/compatibility`,
      requestId,
      { cuerpo: { perfil } },
    );
  }

  /** Búsqueda BM25 personalizada con el perfil (POST /search/personalized). */
  buscarPersonalizado(
    solicitud: SolicitudBusquedaPersonalizada,
    requestId: string,
  ): Promise<RespuestaBusquedaPersonalizada> {
    return this.pedir<RespuestaBusquedaPersonalizada>(
      "POST",
      "/search/personalized",
      requestId,
      { cuerpo: solicitud },
    );
  }

  private get<T>(
    ruta: string,
    requestId: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return this.pedir<T>("GET", ruta, requestId, { params });
  }

  /**
   * Petición a FastAPI con timeout, reintentos, X-Request-ID, X-Clave-Servicio
   * y errores del contrato. Los POST también se reintentan: el motor
   * adaptativo no guarda estado, así que repetirlos no tiene efectos.
   */
  private async pedir<T>(
    metodo: Metodo,
    ruta: string,
    requestId: string,
    { params, cuerpo }: OpcionesPeticion = {},
  ): Promise<T> {
    const url = `${this.pythonApiUrl}${ruta}`;
    const headers = headersFastApi(this.configService, requestId);
    const peticion =
      metodo === "GET"
        ? this.httpService.get<T>(url, { ...(params && { params }), headers })
        : this.httpService.post<T>(url, cuerpo, { headers });
    try {
      const response = await firstValueFrom(
        peticion.pipe(
          // retry vuelve a suscribirse, y HttpService repite la petición.
          retry({
            count: this.reintentos,
            delay: (error, intento) =>
              this.esperarReintento(error, intento, metodo, ruta, requestId),
          }),
        ),
      );
      return response.data;
    } catch (error) {
      throw this.traducirError(error, metodo, ruta, requestId);
    }
  }

  private esperarReintento(
    error: unknown,
    intento: number,
    metodo: Metodo,
    ruta: string,
    requestId: string,
  ) {
    if (!esTransitorio(error)) {
      return throwError(() => error);
    }
    const espera =
      BACKOFF_BASE_MS * 2 ** (intento - 1) +
      Math.floor(Math.random() * (JITTER_MAX_MS + 1));
    this.logger.warn(
      `[${requestId}] Reintento ${intento}/${this.reintentos} de ${metodo} ${ruta} tras ${motivo(error)}; espera ${espera} ms`,
    );
    return timer(espera);
  }

  private traducirError(
    error: unknown,
    metodo: Metodo,
    ruta: string,
    requestId: string,
  ): ContratoHttpException {
    if (!isAxiosError(error)) {
      this.logger.error(`[${requestId}] Error inesperado: ${error}`);
      return ContratoHttpException.crear(
        HttpStatus.INTERNAL_SERVER_ERROR,
        CodigoError.INTERNAL_ERROR,
        "Error interno al consultar el servicio de búsqueda",
        requestId,
      );
    }

    const { response } = error;
    // 403: FastAPI rechazó la clave entre servicios. 422 en un POST: el cuerpo
    // que armamos no cumple el contrato. Los dos son errores nuestros (de
    // configuración o de código), no del usuario: 502 para que se use el
    // respaldo y el detalle quede solo en el log.
    if (
      response &&
      (response.status === HttpStatus.FORBIDDEN ||
        (metodo === "POST" &&
          response.status === HttpStatus.UNPROCESSABLE_ENTITY))
    ) {
      this.logger.error(
        `[${requestId}] FastAPI rechazó ${metodo} ${ruta} con ${response.status}${
          response.status === HttpStatus.FORBIDDEN
            ? ": revisar CLAVE_SERVICIO"
            : ": el cuerpo enviado no cumple el contrato"
        }`,
      );
      return ContratoHttpException.crear(
        HttpStatus.BAD_GATEWAY,
        CodigoError.INTERNAL_ERROR,
        "Respuesta inesperada del servicio de búsqueda",
        requestId,
      );
    }

    if (response && esErrorContrato(response.data)) {
      this.logger.warn(
        `[${requestId}] FastAPI respondió ${response.status} ${response.data.error.codigo}`,
      );
      return new ContratoHttpException(response.status, response.data);
    }

    if (response) {
      this.logger.error(
        `[${requestId}] FastAPI respondió ${response.status} fuera del contrato`,
      );
      return ContratoHttpException.crear(
        HttpStatus.BAD_GATEWAY,
        CodigoError.INTERNAL_ERROR,
        "Respuesta inesperada del servicio de búsqueda",
        requestId,
      );
    }

    if (CODIGOS_TIMEOUT.has(error.code)) {
      this.logger.warn(`[${requestId}] FastAPI no respondió a tiempo`);
      return ContratoHttpException.crear(
        HttpStatus.GATEWAY_TIMEOUT,
        CodigoError.SOURCE_TIMEOUT,
        "El servicio de búsqueda no respondió a tiempo",
        requestId,
      );
    }

    this.logger.warn(
      `[${requestId}] FastAPI no disponible: ${error.code ?? error.message}`,
    );
    return ContratoHttpException.crear(
      HttpStatus.SERVICE_UNAVAILABLE,
      CodigoError.SOURCE_UNAVAILABLE,
      "El servicio de búsqueda no está disponible",
      requestId,
    );
  }
}

/**
 * Se reintenta si no hubo respuesta (sin conexión o timeout) o si FastAPI
 * respondió 502, 503 o 504. Nunca los 4xx ni el 500.
 */
function esTransitorio(error: unknown): error is AxiosError {
  if (!isAxiosError(error) || error.code === AxiosError.ERR_CANCELED) {
    return false;
  }
  return error.response ? STATUS_TRANSITORIOS.has(error.response.status) : true;
}

function motivo(error: AxiosError): string {
  return error.response
    ? `HTTP ${error.response.status}`
    : (error.code ?? error.message);
}
