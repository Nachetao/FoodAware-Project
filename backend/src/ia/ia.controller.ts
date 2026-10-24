import { Controller, Post, Body } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { IaAnalysisService } from "./ia.service";
import { AnalizarProductoDto } from "./dto/analizar-producto.dto";
import { Public, UsuarioActual } from "../auth/decoradores";
import { UsuarioToken } from "../auth/jwt.strategy";

@Controller("food")
export class IaController {
  constructor(private readonly iaAnalysisService: IaAnalysisService) {}

  // Público para el frontend actual, que todavía no tiene login.
  @Public()
  @Post("analizar")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Analiza un producto (token opcional)",
    description:
      "Sin token analiza sin usuario. Con un token válido cruza los alérgenos con los del usuario del token. El userId del body se ignora.",
  })
  async analizar(
    @Body() body: AnalizarProductoDto,
    @UsuarioActual() usuario: UsuarioToken | null,
  ) {
    const { nombre, ingredientes } = body;

    const resultado = await this.iaAnalysisService.analizarProducto(
      nombre,
      ingredientes,
      usuario?.id,
    );

    return {
      message: "Análisis completado",
      resultado,
    };
  }
}
