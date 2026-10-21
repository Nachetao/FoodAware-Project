import { ApiProperty } from "@nestjs/swagger";
import { ESTADOS_FUENTE, EstadoFuente } from "./enums";
import { Producto } from "./producto";

/** Parámetros de GET /search. */
export interface ParametrosBusqueda {
  q: string;
  limit: number;
  offset: number;
}

export class ResultadoBusqueda {
  @ApiProperty({ type: () => Producto })
  producto: Producto;

  @ApiProperty({
    minimum: 0,
    description: "Puntaje de relevancia; mayor es más relevante.",
    example: 7.42,
  })
  score: number;

  @ApiProperty({
    minimum: 1,
    description: "Posición en el ranking, desde 1.",
    example: 1,
  })
  posicion: number;
}

export class RespuestaBusqueda {
  @ApiProperty({
    minLength: 2,
    maxLength: 100,
    description: "Consulta tal como se procesó.",
    example: "leche sin lactosa",
  })
  consulta: string;

  @ApiProperty({
    minimum: 0,
    description: "Total de coincidencias antes de paginar.",
    example: 23,
  })
  total: number;

  @ApiProperty({
    minimum: 0,
    description: "Tiempo de la búsqueda en ms.",
    example: 12.5,
  })
  tiempo_ms: number;

  @ApiProperty({ type: () => [ResultadoBusqueda] })
  resultados: ResultadoBusqueda[];

  @ApiProperty({
    enum: ESTADOS_FUENTE,
    description:
      "'cache' si la fuente no respondió y se usaron datos almacenados.",
    example: "online",
  })
  estado_fuente: EstadoFuente;
}
