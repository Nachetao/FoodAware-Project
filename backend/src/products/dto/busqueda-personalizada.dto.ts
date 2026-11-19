import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import {
  ComparacionRanking,
  MODOS_BUSQUEDA,
  ModoBusqueda,
  RespuestaBusquedaPersonalizada,
  ResultadoPersonalizado,
} from "../contrato/adaptativo";
import { BuscarProductosQueryDto } from "./buscar-productos.query.dto";
import { VeredictoBackend } from "./compatibilidad.dto";

/** Query de GET /api/products/search/personalizada. */
export class BuscarPersonalizadoQueryDto extends BuscarProductosQueryDto {
  @ApiPropertyOptional({
    enum: MODOS_BUSQUEDA,
    default: "filtrar",
    description:
      "filtrar oculta los no_apto; reordenar los deja al final. En los dos casos no_aptos dice cuántos hay y por qué.",
  })
  @IsIn(MODOS_BUSQUEDA, { message: "modo debe ser filtrar o reordenar" })
  modo: ModoBusqueda = "filtrar";
}

export class ResultadoPersonalizadoBackend extends OmitType(
  ResultadoPersonalizado,
  ["veredicto"] as const,
) {
  @ApiProperty({ type: () => VeredictoBackend })
  veredicto: VeredictoBackend;
}

/**
 * Respuesta de GET /api/products/search/personalizada: la del motor (POST
 * /search/personalized) tal cual. En el respaldo, comparacion es null.
 */
export class BusquedaPersonalizada extends OmitType(
  RespuestaBusquedaPersonalizada,
  ["resultados", "comparacion"] as const,
) {
  @ApiProperty({ type: () => [ResultadoPersonalizadoBackend] })
  resultados: ResultadoPersonalizadoBackend[];

  @ApiProperty({
    type: () => ComparacionRanking,
    nullable: true,
    description:
      "Top 5 del ranking base frente al personalizado. null en el respaldo (X-Fuente-Datos: respaldo), que no tiene ranking base con qué comparar.",
  })
  comparacion: ComparacionRanking | null;
}
