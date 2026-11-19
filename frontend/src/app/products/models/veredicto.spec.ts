import {
  enumerar,
  presentarConfianza,
  presentarVeredicto,
  textoInterpretacion,
  textoNoReconocidas,
} from './veredicto';

describe('presentarVeredicto', () => {
  it.each([
    ['apto', 'Apto para ti', 'Apto', 'checkmark-circle-outline', 'apto'],
    [
      'apto_con_advertencia',
      'Apto con advertencia',
      'Con advertencia',
      'warning-outline',
      'apto-con-advertencia',
    ],
    ['no_apto', 'No apto para ti', 'No apto', 'close-circle-outline', 'no-apto'],
  ])('%s: título, chip, ícono y clase propios', (veredicto, titulo, chip, icono, clase) => {
    expect(presentarVeredicto(veredicto)).toEqual({ titulo, chip, icono, clase });
  });

  it('cada estado se distingue sin color: títulos, chips e íconos distintos', () => {
    const estados = ['apto', 'apto_con_advertencia', 'no_apto'].map(presentarVeredicto);

    for (const campo of ['titulo', 'chip', 'icono'] as const) {
      expect(new Set(estados.map((e) => e[campo])).size).toBe(3);
    }
  });

  it('un veredicto desconocido se muestra como advertencia, nunca como apto', () => {
    expect(presentarVeredicto('otro').clase).toBe('apto-con-advertencia');
  });
});

describe('presentarConfianza', () => {
  it.each([
    ['alta', 'Alta', 3, 'Datos completos y declarados por la fuente.'],
    ['media', 'Media', 2, 'Parte de la información está incompleta o se dedujo del texto.'],
    ['baja', 'Baja', 1, 'Faltan datos o es una revisión básica: revisa la etiqueta.'],
  ])('%s: etiqueta %s, nivel %i y su frase', (confianza, etiqueta, nivel, frase) => {
    expect(presentarConfianza(confianza)).toEqual({ etiqueta, nivel, frase });
  });

  it('una confianza desconocida se muestra como baja', () => {
    expect(presentarConfianza('otra').nivel).toBe(1);
  });
});

describe('enumerar', () => {
  it.each([
    [[], ''],
    [['a'], 'a'],
    [['a', 'b'], 'a y b'],
    [['a', 'b', 'c'], 'a, b y c'],
  ])('%j → "%s"', (partes, texto) => {
    expect(enumerar(partes)).toBe(texto);
  });
});

describe('textoInterpretacion', () => {
  it('es null si la consulta no traía restricciones', () => {
    expect(textoInterpretacion({ terminos: ['galleta'] })).toBeNull();
    expect(textoInterpretacion({ terminos: ['galleta'], restricciones: [] })).toBeNull();
  });

  it('explica una restricción de alérgeno', () => {
    expect(
      textoInterpretacion({
        terminos: ['chocolate'],
        restricciones: [{ texto: 'sin leche', tipo: 'alergeno', codigo: 'lacteos' }],
      }),
    ).toBe('Buscamos «chocolate» sin lácteos (por «sin leche»).');
  });

  it('explica varias restricciones, incluida una dieta', () => {
    expect(
      textoInterpretacion({
        terminos: ['galleta', 'avena'],
        restricciones: [
          { texto: 'sin leche', tipo: 'alergeno', codigo: 'lacteos' },
          { texto: 'ni huevo', tipo: 'alergeno', codigo: 'huevo' },
          { texto: 'sin lactosa', tipo: 'dieta', codigo: 'sin_lactosa' },
        ],
      }),
    ).toBe(
      'Buscamos «galleta avena» sin lácteos (por «sin leche»), sin huevo (por «ni huevo») y compatible con la dieta sin lactosa (por «sin lactosa»).',
    );
  });
});

describe('textoNoReconocidas', () => {
  it('es null si todo se reconoció', () => {
    expect(textoNoReconocidas({ terminos: ['galleta'] })).toBeNull();
    expect(textoNoReconocidas({ terminos: ['galleta'], no_reconocidas: [] })).toBeNull();
  });

  it('lista lo que no se reconoció', () => {
    expect(
      textoNoReconocidas({
        terminos: ['galleta', 'azucar'],
        no_reconocidas: ['sin azúcar', 'sin sal'],
      }),
    ).toBe('No reconocimos «sin azúcar» y «sin sal» como alérgeno ni dieta: se buscó como texto.');
  });
});
