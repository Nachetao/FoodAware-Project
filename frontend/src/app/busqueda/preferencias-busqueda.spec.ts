import {
  CLAVE_PREFERENCIAS,
  guardarPreferencias,
  leerPreferencias,
} from './preferencias-busqueda';

describe('preferencias de la búsqueda', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('sin nada guardado: no personalizar y modo filtrar', () => {
    expect(leerPreferencias()).toEqual({ personalizar: false, modo: 'filtrar' });
  });

  it('guarda y vuelve a leer la elección', () => {
    guardarPreferencias({ personalizar: true, modo: 'reordenar' });

    expect(JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS)!)).toEqual({
      personalizar: true,
      modo: 'reordenar',
    });
    expect(leerPreferencias()).toEqual({ personalizar: true, modo: 'reordenar' });
  });

  it.each([
    ['un JSON dañado', '{no es json'],
    ['tipos inválidos', JSON.stringify({ personalizar: 'si', modo: 'otro' })],
    ['un valor que no es objeto', 'null'],
  ])('con %s usa los valores por defecto', (_caso, crudo) => {
    localStorage.setItem(CLAVE_PREFERENCIAS, crudo);

    expect(leerPreferencias()).toEqual({ personalizar: false, modo: 'filtrar' });
  });

  it('valida cada campo por separado', () => {
    localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify({ personalizar: true, modo: 'x' }));

    expect(leerPreferencias()).toEqual({ personalizar: true, modo: 'filtrar' });
  });

  it('si localStorage falla al leer, usa los valores por defecto', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });

    expect(leerPreferencias()).toEqual({ personalizar: false, modo: 'filtrar' });
  });

  it('si localStorage falla al guardar, no lanza', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('lleno');
    });

    expect(() => guardarPreferencias({ personalizar: true, modo: 'filtrar' })).not.toThrow();
  });
});
