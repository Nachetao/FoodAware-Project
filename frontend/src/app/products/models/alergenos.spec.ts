import { etiquetaAlergeno } from './alergenos';

describe('etiquetaAlergeno', () => {
  it('devuelve el nombre para mostrar de un código del contrato', () => {
    expect(etiquetaAlergeno('mani')).toBe('Maní');
    expect(etiquetaAlergeno('frutos_secos')).toBe('Frutos secos');
  });

  it('devuelve el código tal cual si no lo conoce', () => {
    expect(etiquetaAlergeno('nuevo_alergeno')).toBe('nuevo_alergeno');
  });
});
