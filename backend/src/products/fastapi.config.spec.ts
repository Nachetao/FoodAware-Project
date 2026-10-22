import { ConfigService } from "@nestjs/config";
import { leerEntero } from "./fastapi.config";

function configCon(valor: unknown): ConfigService {
  return { get: () => valor } as unknown as ConfigService;
}

describe("leerEntero", () => {
  it.each([
    ["un texto entero", "3", 3],
    ["un número", 5, 5],
    ["cero", "0", 0],
  ])("usa %s", (_caso, valor, esperado) => {
    expect(leerEntero(configCon(valor), "CLAVE", 2)).toBe(esperado);
  });

  it.each([
    ["falta", undefined],
    ["está vacío", ""],
    ["no es un número", "abc"],
    ["es negativo", "-1"],
    ["tiene decimales", "1.5"],
  ])("usa el valor por defecto si %s", (_caso, valor) => {
    expect(leerEntero(configCon(valor), "CLAVE", 2)).toBe(2);
  });

  it("usa el valor por defecto si es menor que el mínimo", () => {
    expect(leerEntero(configCon("0"), "CLAVE", 2000, 1)).toBe(2000);
  });
});
