import { Controller, Get, Query, Req, Res, UseFilters } from "@nestjs/common";
import {
  ApiBadGatewayResponse,
  ApiGatewayTimeoutResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { RespuestaBusqueda } from "./contrato/busqueda";
import { ErrorContrato } from "./contrato/error";
import { HEADER_REQUEST_ID } from "./contrato/request-id";
import { ContratoExceptionFilter } from "./contrato-exception.filter";
import { BuscarProductosQueryDto } from "./dto/buscar-productos.query.dto";
import { ProductsService } from "./products.service";
import { requestIdDe } from "../observabilidad/request-id";
import { HEADER_FUENTE_DATOS } from "./fuente-datos";

const HEADER_RESPUESTA = {
  [HEADER_REQUEST_ID]: {
    description: "ID de la petición, el mismo que recibe FastAPI.",
    schema: { type: "string" },
  },
  [HEADER_FUENTE_DATOS]: {
    description:
      '"fastapi" en una búsqueda normal; "respaldo" si FastAPI falló y los datos vienen de los productos guardados (estado_fuente es "cache").',
    schema: { type: "string", enum: ["fastapi", "respaldo"] },
  },
};

// Con respaldo: los 500, 502, 503 y 504 solo llegan si la base tampoco tiene resultados.
const SIN_RESPALDO =
  " Solo si los productos guardados tampoco tienen resultados.";

@ApiTags("products")
@Controller("products")
@UseFilters(ContratoExceptionFilter)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get("search")
  @ApiOperation({
    summary: "Busca productos por texto con ranking de relevancia",
    description:
      'Si FastAPI falla (500, 502, 503 o 504, tras los reintentos), responde desde los productos guardados con estado_fuente "cache" y el header X-Fuente-Datos: respaldo.',
  })
  @ApiHeader({
    name: HEADER_REQUEST_ID,
    required: false,
    description:
      "Se reutiliza si cumple [A-Za-z0-9._-]{1,128}; si no, se genera un uuid4.",
  })
  @ApiOkResponse({ type: RespuestaBusqueda, headers: HEADER_RESPUESTA })
  @ApiUnprocessableEntityResponse({
    type: ErrorContrato,
    description: "Parámetros inválidos (VALIDATION_ERROR).",
  })
  @ApiInternalServerErrorResponse({
    type: ErrorContrato,
    description: "Error interno (INTERNAL_ERROR)." + SIN_RESPALDO,
  })
  @ApiBadGatewayResponse({
    type: ErrorContrato,
    description:
      "FastAPI respondió fuera del contrato (INTERNAL_ERROR)." + SIN_RESPALDO,
  })
  @ApiServiceUnavailableResponse({
    type: ErrorContrato,
    description:
      "Servicio de búsqueda no disponible (SOURCE_UNAVAILABLE)." + SIN_RESPALDO,
  })
  @ApiGatewayTimeoutResponse({
    type: ErrorContrato,
    description:
      "Servicio de búsqueda sin respuesta a tiempo (SOURCE_TIMEOUT)." +
      SIN_RESPALDO,
  })
  async buscar(
    @Query() query: BuscarProductosQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespuestaBusqueda> {
    const requestId = requestIdDe(req);
    res.setHeader(HEADER_REQUEST_ID, requestId);
    const { respuesta, fuente } = await this.productsService.buscar(
      query,
      requestId,
    );
    res.setHeader(HEADER_FUENTE_DATOS, fuente);
    return respuesta;
  }
}
