/** Separa una lista de ingredientes escrita con comas, sin espacios ni vacíos. */
export function separarIngredientes(texto: string): string[] {
  return texto
    .split(',')
    .map((ingrediente) => ingrediente.trim())
    .filter((ingrediente) => ingrediente.length > 0);
}
