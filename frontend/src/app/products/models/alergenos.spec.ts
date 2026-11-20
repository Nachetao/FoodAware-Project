import { etiquetaAlergeno, separarAlergenos } from './alergenos';

describe('etiquetaAlergeno', () => {
  it('devuelve el nombre para mostrar de un código del contrato', () => {
    expect(etiquetaAlergeno('mani')).toBe('Maní');
    expect(etiquetaAlergeno('frutos_secos')).toBe('Frutos secos');
  });

  it('devuelve el código tal cual si no lo conoce', () => {
    expect(etiquetaAlergeno('nuevo_alergeno')).toBe('nuevo_alergeno');
  });
});

describe('separarAlergenos', () => {
  it('separa los que chocan con el perfil, manteniendo el orden original', () => {
    expect(separarAlergenos(['gluten', 'lacteos', 'mani', 'soya'], ['soya', 'gluten'])).toEqual({
      enConflicto: ['gluten', 'soya'],
      otros: ['lacteos', 'mani'],
    });
  });

  it('sin perfil (sin sesión) ninguno choca', () => {
    expect(separarAlergenos(['gluten', 'lacteos'], [])).toEqual({
      enConflicto: [],
      otros: ['gluten', 'lacteos'],
    });
  });

  it('si ninguno está en el perfil, todos quedan como informativos', () => {
    expect(separarAlergenos(['huevo'], ['mani'])).toEqual({ enConflicto: [], otros: ['huevo'] });
  });

  it('sin alérgenos en el producto no devuelve nada', () => {
    expect(separarAlergenos([], ['mani'])).toEqual({ enConflicto: [], otros: [] });
  });
});
