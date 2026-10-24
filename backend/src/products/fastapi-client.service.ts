import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { AxiosError, isAxiosError } from "axios";
import { firstValueFrom, retry, throwError, timer } from "rxjs";
import { ParametrosBusqueda, RespuestaBusqueda } from "./contrato/busqueda";
import {
  MetricasCalidad,
  MetricasEvaluacion,
  ResumenIngesta,
} from "./contrato/metricas";
import { CodigoError } from "./contrato/enums";
import { esErrorContrato } from "./contrato/error";
import { HEADER_REQUEST_ID } from "./contrato/request-id";
import { ContratoHttpException } from "./contrato-http.exception";
import { REINTENTOS_FASTAPI_POR_DEFECTO, leerEntero } from "./fastapi.config";

// Códigos de axios cuando se supera el timeout del HttpModule.
const CODIGOS_TIMEOUT = new Set(["ECONNABORTED", "ETIMEDOUT"]);
// Respuestas de FastAPI que pueden resolverse solas al reintentar.
// El 500 no está: es un error del propio servicio y se repetiría.
const STATUS_TRANSITORIOS = new Set([502, 503, 504]);
// Espera antes del reintento n: BACKOFF_BASE_MS · 2^(n-1) + jitter aleatorio.
const BACKOFF_BASE_MS = 250;
const JITTER_MAX_MS = 100;

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

  /** GET a FastAPI con timeout, reintentos, X-Request-ID y errores del contrato. */
  private async get<T>(
    ruta: string,
    requestId: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService
          .get<T>(`${this.pythonApiUrl}${ruta}`, {
            ...(params && { params }),
            headers: { [HEADER_REQUEST_ID]: requestId },
          })
          .pipe(
            // retry vuelve a suscribirse, y HttpService repite la petición.
            retry({
              count: this.reintentos,
              delay: (error, intento) =>
                this.esperarReintento(error, intento, ruta, requestId),
            }),
          ),
      );
      return response.data;
    } catch (error) {
      throw this.traducirError(error, requestId);
    }
  }

  private esperarReintento(
    error: unknown,
    intento: number,
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
      `[${requestId}] Reintento ${intento}/${this.reintentos} de GET ${ruta} tras ${motivo(error)}; espera ${espera} ms`,
    );
    return timer(espera);
  }

  private traducirError(
    error: unknown,
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
