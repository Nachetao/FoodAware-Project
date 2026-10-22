import { EstadoFuente } from './enums';
import { Producto } from './producto';

export interface ResultadoBusqueda {
  producto: Producto;
  /** Puntaje de relevancia; mayor es más relevante. */
  score: number;
  /** Posición global en el ranking, desde 1. */
  posicion: number;
}

export interface RespuestaBusqueda {
  consulta: string;
  /** Total de coincidencias antes de paginar. */
  total: number;
  tiempo_ms: number;
  resultados: ResultadoBusqueda[];
  estado_fuente: EstadoFuente;
}
