import { EstadoFuente } from './enums';
import { Producto } from './producto';

export interface ResultadoBusqueda {
  producto: Producto;
  /** Puntaje de relevancia; mayor es más relevante. */
  score: number;
  /** Posición global en el ranking, desde 1. */
  posicion: number;
}

/** Respuesta de la búsqueda más el origen de los datos. */
export interface BusquedaProductos {
  respuesta: RespuestaBusqueda;
  /**
   * true si FastAPI no respondió y el backend usó los productos guardados
   * (header X-Fuente-Datos: respaldo).
   */
  desdeRespaldo: boolean;
}

export interface RespuestaBusqueda {
  consulta: string;
  /** Total de coincidencias antes de paginar. */
  total: number;
  tiempo_ms: number;
  resultados: ResultadoBusqueda[];
  estado_fuente: EstadoFuente;
}
