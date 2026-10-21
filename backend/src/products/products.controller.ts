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
import { resolverRequestId } from "./resolver-request-id";

const HEADER_RESPUESTA = {
  [HEADER_REQUEST_ID]: {
    description: "ID de la petición, el mismo que recibe FastAPI.",
    schema: { type: "string" },
  },
};

@ApiTags("products")
@Controller("products")
@UseFilters(ContratoExceptionFilter)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get("search")
  @ApiOperation({
    summary: "Busca productos por texto con ranking de relevancia",
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
    description: "Error interno (INTERNAL_ERROR).",
  })
  @ApiBadGatewayResponse({
    type: ErrorContrato,
    description: "FastAPI respondió fuera del contrato (INTERNAL_ERROR).",
  })
  @ApiServiceUnavailableResponse({
    type: ErrorContrato,
    description: "Servicio de búsqueda no disponible (SOURCE_UNAVAILABLE).",
  })
  @ApiGatewayTimeoutResponse({
    type: ErrorContrato,
    description:
      "Servicio de búsqueda sin respuesta a tiempo (SOURCE_TIMEOUT).",
  })
  async buscar(
    @Query() query: BuscarProductosQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespuestaBusqueda> {
    const requestId = resolverRequestId(req);
    res.setHeader(HEADER_REQUEST_ID, requestId);
    return this.productsService.buscar(query, requestId);
  }
}
