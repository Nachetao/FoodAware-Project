import { tokensRespaldo } from "./busqueda-respaldo";

describe("tokensRespaldo", () => {
  it.each([
    [
      "minúsculas, stopwords y singular",
      "Galletas de AVENA",
      ["galleta", "avena"],
    ],
    ["sin tildes ni eñes", "Maní y Piña", ["mani", "pina"]],
    ["separa por signos", "pan-integral, 100%", ["pan", "integral", "100"]],
    ["no singulariza palabras de 3 letras", "Pan gas", ["pan", "gas"]],
    ["sin repetidos", "leche leches LECHE", ["leche"]],
    ["descarta tokens de 1 carácter", "a b leche", ["leche"]],
  ])("normaliza: %s", (_caso, consulta, esperado) => {
    expect(tokensRespaldo(consulta)).toEqual(esperado);
  });

  it("devuelve una lista vacía si solo hay stopwords", () => {
    expect(tokensRespaldo("de la con")).toEqual([]);
  });
});
