import { Controller, Post, Body } from "@nestjs/common";
import { IaAnalysisService } from "./ia.service";
import { AnalizarProductoDto } from "./dto/analizar-producto.dto";

@Controller("food")
export class IaController {
  constructor(private readonly iaAnalysisService: IaAnalysisService) {}

  @Post("analizar")
  async analizar(@Body() body: AnalizarProductoDto) {
    const { nombre, ingredientes, userId } = body;

    const resultado = await this.iaAnalysisService.analizarProducto(
      nombre,
      ingredientes,
      userId,
    );

    return {
      message: "Análisis completado",
      resultado,
    };
  }
}
