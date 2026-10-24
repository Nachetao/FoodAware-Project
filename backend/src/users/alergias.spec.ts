import { AllergenCode } from "../products/contrato/enums";
import { aCodigoAlergeno, aCodigosAlergenos } from "./alergias";
import { tieneConflicto } from "../ia/ia.service";

describe("aCodigoAlergeno", () => {
  it.each([
    ["maní", AllergenCode.MANI],
    ["Maní", AllergenCode.MANI],
    ["lácteos", AllergenCode.LACTEOS],
    ["Leche", AllergenCode.LACTEOS],
    ["SOJA", AllergenCode.SOYA],
    ["frutos_secos", AllergenCode.FRUTOS_SECOS],
    ["  Frutos   secos ", AllergenCode.FRUTOS_SECOS],
    ["sésamo", AllergenCode.SESAMO],
    ["crustáceos", AllergenCode.CRUSTACEOS],
  ])("%s → %s", (texto, codigo) => {
    expect(aCodigoAlergeno(texto)).toBe(codigo);
  });

  it("cada uno de los 14 códigos del contrato se reconoce a sí mismo", () => {
    for (const codigo of Object.values(AllergenCode)) {
      expect(aCodigoAlergeno(codigo)).toBe(codigo);
    }
  });

  it.each(["pan", "chocolate", ""])(
    "devuelve null si no lo reconoce (%p)",
    (texto) => {
      expect(aCodigoAlergeno(texto)).toBeNull();
    },
  );
});

describe("aCodigosAlergenos", () => {
  it("descarta lo desconocido y no repite", () => {
    expect(aCodigosAlergenos(["Leche", "lácteos", "pan", "maní"])).toEqual([
      AllergenCode.LACTEOS,
      AllergenCode.MANI,
    ]);
  });
});

describe("tieneConflicto (análisis contra las alergias del usuario)", () => {
  it("cruza los alérgenos con tilde de FastAPI con los códigos del usuario", () => {
    expect(tieneConflicto(["lácteos"], [AllergenCode.LACTEOS])).toBe(true);
    expect(tieneConflicto(["maní"], [AllergenCode.MANI])).toBe(true);
  });

  it("no hay conflicto si el usuario no es alérgico a lo detectado", () => {
    expect(tieneConflicto(["lácteos"], [AllergenCode.MANI])).toBe(false);
    expect(tieneConflicto([], [AllergenCode.MANI])).toBe(false);
    expect(tieneConflicto(["maní"], [])).toBe(false);
  });
});
