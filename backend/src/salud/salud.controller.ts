import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Response } from "express";
import { RespuestaSalud } from "./salud.dto";
import { SaludService } from "./salud.service";

@ApiTags("salud")
@Controller("health")
export class SaludController {
  constructor(private readonly saludService: SaludService) {}

  @Get()
  @ApiOperation({
    summary: "Estado del backend y de sus dependencias",
    description:
      "Verifica PostgreSQL (SELECT 1) y FastAPI (su /health), cada uno con un timeout de 2 s. Mismo formato que el /health de FastAPI.",
  })
  @ApiOkResponse({
    type: RespuestaSalud,
    description: "estado ok, o degradado si FastAPI no está ok.",
  })
  @ApiServiceUnavailableResponse({
    type: RespuestaSalud,
    description: "estado error: PostgreSQL no responde.",
  })
  async verificar(
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespuestaSalud> {
    const salud = await this.saludService.verificar();
    res.status(
      salud.estado === "error" ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK,
    );
    return salud;
  }
}
