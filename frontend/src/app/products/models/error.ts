import { CODIGOS_ERROR, CodigoError } from './enums';

export interface DetalleError {
  codigo: CodigoError;
  mensaje: string;
  request_id: string;
}

/** Cuerpo de error del contrato: {"error": {codigo, mensaje, request_id}}. */
export interface ErrorContrato {
  error: DetalleError;
}

export function esErrorContrato(cuerpo: unknown): cuerpo is ErrorContrato {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return false;
  }
  const error = (cuerpo as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { codigo, mensaje, request_id } = error as Partial<
    Record<keyof DetalleError, unknown>
  >;
  return (
    (CODIGOS_ERROR as readonly unknown[]).includes(codigo) &&
    typeof mensaje === 'string' &&
    typeof request_id === 'string'
  );
}

/** Error de una llamada al backend, listo para mostrar en la UI. */
export interface ErrorApi {
  /** Status HTTP; 0 si no hubo respuesta del servidor. */
  status: number;
  /** Código del contrato, o null si la respuesta no lo traía. */
  codigo: CodigoError | null;
  mensaje: string;
  requestId: string | null;
}
