import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiGatewayTimeoutResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { RespuestaBusqueda } from "./contrato/busqueda";
import { ErrorContrato } from "./contrato/error";
import { HEADER_REQUEST_ID } from "./contrato/request-id";
import { ContratoExceptionFilter } from "./contrato-exception.filter";
import { BuscarProductosQueryDto } from "./dto/buscar-productos.query.dto";
import { CodigoBarrasParamDto } from "./dto/codigo-barras.param.dto";
import { Producto } from "./contrato/producto";
import { ProductsService } from "./products.service";
import { requestIdDe } from "../observabilidad/request-id";
import { HEADER_FUENTE_DATOS } from "./fuente-datos";
import { Public, UsuarioActual } from "../auth/decoradores";
import { UsuarioToken } from "../auth/jwt.strategy";
import { Compatibilidad } from "./dto/compatibilidad.dto";

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

  @Public()
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

  // Antes de ":codigo_barras": si no, "compatibles" se tomaría como un código.
  @Get("compatibles")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Productos guardados compatibles con las alergias del usuario",
    description:
      "Requiere token. Busca en los productos guardados (mismo ranking que el respaldo) y excluye los que contienen alguno de los alérgenos del usuario. Misma forma que /search, con estado_fuente \"cache\".",
  })
  @ApiOkResponse({ type: RespuestaBusqueda })
  @ApiUnauthorizedResponse({ description: "Falta el token o no es válido." })
  @ApiUnprocessableEntityResponse({
    type: ErrorContrato,
    description: "Parámetros inválidos (VALIDATION_ERROR).",
  })
  compatibles(
    @Query() query: BuscarProductosQueryDto,
    @UsuarioActual() usuario: UsuarioToken,
  ): Promise<RespuestaBusqueda> {
    return this.productsService.compatibles(query, usuario.id);
  }

  @Get(":codigo_barras/compatibilidad")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Compatibilidad del producto con las alergias del usuario",
    description:
      "Requiere token. apto es false si algún alérgeno coincide; las trazas que coinciden se informan pero no lo hacen no apto. El producto se obtiene como en el detalle (X-Fuente-Datos indica si vino del respaldo).",
  })
  @ApiParam({ name: "codigo_barras", description: "De 8 a 14 dígitos." })
  @ApiOkResponse({ type: Compatibilidad, headers: HEADER_RESPUESTA })
  @ApiUnauthorizedResponse({ description: "Falta el token o no es válido." })
  @ApiNotFoundResponse({
    type: ErrorContrato,
    description: "El producto no existe (NOT_FOUND).",
  })
  async compatibilidad(
    @Param() { codigo_barras }: CodigoBarrasParamDto,
    @UsuarioActual() usuario: UsuarioToken,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Compatibilidad> {
    const { respuesta, fuente } = await this.productsService.compatibilidad(
      codigo_barras,
      usuario.id,
      requestIdDe(req),
    );
    res.setHeader(HEADER_FUENTE_DATOS, fuente);
    return respuesta;
  }

  // Después de "search": si no, /products/search se tomaría como un código.
  @Public()
  @Get(":codigo_barras")
  @ApiOperation({
    summary: "Detalle de un producto por código de barras",
    description:
      "Consulta /products/{codigo_barras} de FastAPI y guarda el producto. Si FastAPI falla (500, 502, 503 o 504) responde el producto guardado con X-Fuente-Datos: respaldo. Un 404 de FastAPI se propaga.",
  })
  @ApiParam({ name: "codigo_barras", description: "De 8 a 14 dígitos." })
  @ApiOkResponse({ type: Producto, headers: HEADER_RESPUESTA })
  @ApiNotFoundResponse({
    type: ErrorContrato,
    description: "El producto no existe (NOT_FOUND).",
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorContrato,
    description: "Código de barras inválido (VALIDATION_ERROR).",
  })
  @ApiServiceUnavailableResponse({
    type: ErrorContrato,
    description: "FastAPI no disponible y el producto no está guardado.",
  })
  @ApiGatewayTimeoutResponse({
    type: ErrorContrato,
    description:
      "FastAPI sin respuesta a tiempo y el producto no está guardado.",
  })
  async obtener(
    @Param() { codigo_barras }: CodigoBarrasParamDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Producto> {
    const requestId = requestIdDe(req);
    const { respuesta, fuente } = await this.productsService.obtener(
      codigo_barras,
      requestId,
    );
    res.setHeader(HEADER_FUENTE_DATOS, fuente);
    return respuesta;
  }
}
