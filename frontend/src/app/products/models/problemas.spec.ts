import { esProblemaDeAlergenos, explicarProblema } from './problemas';

describe('explicarProblema', () => {
  it.each([
    ['alergeno_detectado_en_texto:lacteos', 'Lácteos detectado en el texto de ingredientes.'],
    ['traza_detectada_en_texto:frutos_secos', 'Trazas de frutos secos detectadas en el texto de ingredientes.'],
    ['alergeno_posible:soya', 'Posible presencia de soya (indicio sin confirmar, no se marca como alérgeno).'],
    ['alergenos_no_reconocidos', 'Open Food Facts informa alérgenos que no se pudieron reconocer.'],
    ['sin_imagen', 'La fuente no tiene imagen del producto.'],
    ['codigo_barras_digito_verificador_invalido', 'El dígito verificador del código de barras no coincide.'],
    ['posible_duplicado:7801234000025', 'Posible duplicado del producto con código 7801234000025.'],
  ])('%s → %s', (codigo, texto) => {
    expect(explicarProblema(codigo)).toBe(texto);
  });

  it.each(['codigo_nuevo', 'otro_codigo:con_detalle'])(
    'muestra tal cual un código desconocido (%s)',
    (codigo) => {
      expect(explicarProblema(codigo)).toBe(codigo);
    },
  );

  it('con un alérgeno desconocido muestra su código', () => {
    expect(explicarProblema('alergeno_detectado_en_texto:alergeno_nuevo')).toBe(
      'alergeno_nuevo detectado en el texto de ingredientes.',
    );
  });

  it('separa los problemas que explican los alérgenos', () => {
    expect(esProblemaDeAlergenos('alergeno_detectado_en_texto:mani')).toBe(true);
    expect(esProblemaDeAlergenos('alergenos_no_reconocidos')).toBe(true);
    expect(esProblemaDeAlergenos('sin_imagen')).toBe(false);
    expect(esProblemaDeAlergenos('codigo_nuevo')).toBe(false);
  });
});
