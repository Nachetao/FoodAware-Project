import { separarIngredientes } from './ingredientes';

describe('separarIngredientes', () => {
  it('separa por comas y quita los espacios de cada ingrediente', () => {
    expect(separarIngredientes(' avena,maní ,  azúcar ')).toEqual([
      'avena',
      'maní',
      'azúcar',
    ]);
  });

  it('descarta los ingredientes vacíos', () => {
    expect(separarIngredientes('avena,, ,miel,')).toEqual(['avena', 'miel']);
  });

  it('devuelve una lista vacía si no hay ningún ingrediente', () => {
    expect(separarIngredientes(' , ,')).toEqual([]);
    expect(separarIngredientes('')).toEqual([]);
  });

  it('un texto sin comas es un solo ingrediente', () => {
    expect(separarIngredientes('harina de trigo')).toEqual(['harina de trigo']);
  });
});
