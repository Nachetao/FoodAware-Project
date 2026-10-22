import { Request, Response } from "express";
import {
  requestIdActual,
  requestIdDe,
  requestIdMiddleware,
} from "./request-id";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function peticion(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

describe("request id", () => {
  it("reutiliza un X-Request-ID válido", () => {
    expect(requestIdDe(peticion({ "x-request-id": "prueba-123" }))).toBe(
      "prueba-123",
    );
  });

  it.each([
    ["no viene", {}],
    ["tiene caracteres no permitidos", { "x-request-id": "id con espacios" }],
    ["supera 128 caracteres", { "x-request-id": "a".repeat(129) }],
  ])("genera un uuid4 si %s", (_caso, headers) => {
    expect(requestIdDe(peticion(headers))).toMatch(UUID);
  });

  it("devuelve siempre el mismo id para la misma petición", () => {
    const req = peticion();
    expect(requestIdDe(req)).toBe(requestIdDe(req));
  });

  it("el middleware pone el id en la respuesta y en el contexto de la petición", () => {
    const req = peticion({ "x-request-id": "prueba-456" });
    const res = { setHeader: jest.fn() } as unknown as Response;
    let enContexto: string | null = null;

    requestIdMiddleware(req, res, () => {
      enContexto = requestIdActual();
    });

    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", "prueba-456");
    expect(enContexto).toBe("prueba-456");
    expect(requestIdActual()).toBeNull();
  });
});
