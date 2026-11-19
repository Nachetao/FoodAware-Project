import { ModoBusqueda } from '../products/models/busqueda-personalizada';

/** Elección del usuario en la búsqueda, recordada entre visitas. */
export interface PreferenciasBusqueda {
  /** true: búsqueda personalizada según el perfil. */
  personalizar: boolean;
  /** Qué hacer con los no aptos al personalizar. */
  modo: ModoBusqueda;
}

export const CLAVE_PREFERENCIAS = 'foodaware.busqueda';

export const PREFERENCIAS_POR_DEFECTO: PreferenciasBusqueda = {
  personalizar: false,
  modo: 'filtrar',
};

/**
 * Lee las preferencias guardadas. localStorage puede no existir o fallar
 * (modo privado, almacenamiento bloqueado) y el valor puede estar dañado: en
 * esos casos usa los valores por defecto, campo por campo.
 */
export function leerPreferencias(): PreferenciasBusqueda {
  try {
    const crudo = localStorage.getItem(CLAVE_PREFERENCIAS);
    const guardadas = crudo ? (JSON.parse(crudo) as Partial<PreferenciasBusqueda>) : {};
    return {
      personalizar:
        typeof guardadas.personalizar === 'boolean'
          ? guardadas.personalizar
          : PREFERENCIAS_POR_DEFECTO.personalizar,
      modo:
        guardadas.modo === 'filtrar' || guardadas.modo === 'reordenar'
          ? guardadas.modo
          : PREFERENCIAS_POR_DEFECTO.modo,
    };
  } catch {
    return { ...PREFERENCIAS_POR_DEFECTO };
  }
}

/** Guarda las preferencias; si el almacenamiento falla, solo no se recuerdan. */
export function guardarPreferencias(preferencias: PreferenciasBusqueda): void {
  try {
    localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify(preferencias));
  } catch {
    // Sin almacenamiento la búsqueda funciona igual.
  }
}
