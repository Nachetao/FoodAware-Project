import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { isAxiosError } from "axios";
import { firstValueFrom } from "rxjs";
import { ParametrosBusqueda, RespuestaBusqueda } from "./contrato/busqueda";
import { CodigoError } from "./contrato/enums";
import { esErrorContrato } from "./contrato/error";
import { HEADER_REQUEST_ID } from "./contrato/request-id";
import { ContratoHttpException } from "./contrato-http.exception";

// Códigos de axios cuando se supera el timeout del HttpModule.
const CODIGOS_TIMEOUT = new Set(["ECONNABORTED", "ETIMEDOUT"]);

@Injectable()
export class FastApiClientService {
  private readonly logger = new Logger(FastApiClientService.name);
  private readonly pythonApiUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.pythonApiUrl = this.configService.get<string>(
      "PYTHON_API_URL",
      "http://localhost:8000",
    );
  }

  async buscar(
    { q, limit, offset }: ParametrosBusqueda,
    requestId: string,
  ): Promise<RespuestaBusqueda> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<RespuestaBusqueda>(`${this.pythonApiUrl}/search`, {
          params: { q, limit, offset },
          headers: { [HEADER_REQUEST_ID]: requestId },
        }),
      );
      return response.data;
    } catch (error) {
      throw this.traducirError(error, requestId);
    }
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
