import { Controller, Get, Req, UseFilters } from "@nestjs/common";
import {
  ApiGatewayTimeoutResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Request } from "express";
import { Public } from "../auth/decoradores";
import { requestIdDe } from "../observabilidad/request-id";
import { ContratoExceptionFilter } from "../products/contrato-exception.filter";
import { ErrorContrato } from "../products/contrato/error";
import {
  MetricasCalidad,
  MetricasEvaluacion,
  ResumenIngesta,
} from "../products/contrato/metricas";
import { FastApiClientService } from "../products/fastapi-client.service";

/**
 * Métricas e ingesta de FastAPI, tal cual las responde. Sin respaldo desde la
 * base: si FastAPI no responde, el error sigue el formato del contrato.
 */
@ApiTags("metricas")
@ApiInternalServerErrorResponse({ type: ErrorContrato })
@ApiServiceUnavailableResponse({
  type: ErrorContrato,
  description: "FastAPI no disponible (SOURCE_UNAVAILABLE).",
})
@ApiGatewayTimeoutResponse({
  type: ErrorContrato,
  description: "FastAPI sin respuesta a tiempo (SOURCE_TIMEOUT).",
})
@Public()
@UseFilters(ContratoExceptionFilter)
@Controller()
export class MetricasController {
  constructor(private readonly fastApiClient: FastApiClientService) {}

  @Get("metricas/calidad")
  @ApiOperation({ summary: "Calidad de los datos (de /metrics/quality)" })
  @ApiOkResponse({ type: MetricasCalidad })
  calidad(@Req() req: Request): Promise<MetricasCalidad> {
    return this.fastApiClient.metricasCalidad(requestIdDe(req));
  }

  @Get("metricas/evaluacion")
  @ApiOperation({
    summary: "Evaluación de la búsqueda (de /metrics/evaluation)",
  })
  @ApiOkResponse({ type: MetricasEvaluacion })
  evaluacion(@Req() req: Request): Promise<MetricasEvaluacion> {
    return this.fastApiClient.metricasEvaluacion(requestIdDe(req));
  }

  @Get("ingesta/ultima")
  @ApiOperation({
    summary: "Última ejecución de ingesta (de /ingest/runs/latest)",
  })
  @ApiOkResponse({ type: ResumenIngesta })
  @ApiNotFoundResponse({
    type: ErrorContrato,
    description: "Todavía no hay ninguna ingesta (NOT_FOUND).",
  })
  ultimaIngesta(@Req() req: Request): Promise<ResumenIngesta> {
    return this.fastApiClient.ultimaIngesta(requestIdDe(req));
  }
}
