import { ORIGENES_DESARROLLO, origenesCors, puerto } from "./despliegue";

describe("origenesCors", () => {
  it("lee la lista separada por comas, sin espacios ni barra final", () => {
    expect(
      origenesCors(
        " https://foodaware-staging-frontend.onrender.com/ , https://otro.cl",
      ),
    ).toEqual([
      "https://foodaware-staging-frontend.onrender.com",
      "https://otro.cl",
    ]);
  });

  it.each([
    ["no está definida", undefined],
    ["está vacía", ""],
    ["solo tiene comas y espacios", " , "],
  ])("usa los orígenes de desarrollo si %s", (_caso, valor) => {
    expect(origenesCors(valor)).toEqual(ORIGENES_DESARROLLO);
  });
});

describe("puerto", () => {
  it("usa PORT si es un número válido", () => {
    expect(puerto("10000")).toBe(10000);
  });

  it.each([undefined, "", "abc", "0"])("usa 3000 con %p", (valor) => {
    expect(puerto(valor)).toBe(3000);
  });
});
