import { duracion, entero, porcentaje, proporcion } from './formato';

describe('formato de métricas', () => {
  it('porcentaje usa coma decimal', () => {
    expect(porcentaje(87.5)).toBe('87,5 %');
    expect(porcentaje(92)).toBe('92 %');
  });

  it('proporcion convierte de 0–1 a porcentaje', () => {
    expect(proporcion(0.51)).toBe('51 %');
  });

  it('entero usa punto de miles', () => {
    expect(entero(1240)).toBe('1.240');
  });

  it.each([
    [850, '850 ms'],
    [45_000, '45 s'],
    [120_000, '2 min'],
    [150_000, '2 min 30 s'],
  ])('duracion(%i) → %s', (ms, esperado) => {
    expect(duracion(ms)).toBe(esperado);
  });
});
