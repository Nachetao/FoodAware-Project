import { normalizarConsulta } from './normalizar-consulta';

describe('normalizarConsulta', () => {
  it('pasa a minúsculas', () => {
    expect(normalizarConsulta('Leche')).toBe('leche');
    expect(normalizarConsulta('LECHE ENTERA')).toBe('leche entera');
  });

  it('quita los espacios al inicio y al final', () => {
    expect(normalizarConsulta('  leche ')).toBe('leche');
  });

  it('reduce los espacios repetidos a uno, también tabs y saltos de línea', () => {
    expect(normalizarConsulta('leche    entera')).toBe('leche entera');
    expect(normalizarConsulta('leche\t\nentera')).toBe('leche entera');
  });

  it('combina las tres cosas', () => {
    expect(normalizarConsulta('  Chocolate   SIN  Leche ')).toBe('chocolate sin leche');
  });

  it('conserva las tildes, la ñ y la puntuación', () => {
    expect(normalizarConsulta('Néctar de Piña')).toBe('néctar de piña');
    expect(normalizarConsulta('Pan, integral')).toBe('pan, integral');
  });

  it('no cambia un texto ya normalizado', () => {
    expect(normalizarConsulta('pan integral')).toBe('pan integral');
  });

  it('devuelve cadena vacía si solo hay espacios', () => {
    expect(normalizarConsulta('')).toBe('');
    expect(normalizarConsulta('   ')).toBe('');
  });
});
