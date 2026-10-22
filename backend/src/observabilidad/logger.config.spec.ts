import pino from "pino";
import { Writable } from "stream";
import { Request, Response } from "express";
import { opcionesPino } from "./logger.config";
import { requestIdMiddleware } from "./request-id";

function crearLogger() {
  const lineas: string[] = [];
  const destino = new Writable({
    write(chunk, _encoding, listo) {
      lineas.push(chunk.toString());
      listo();
    },
  });
  const logger = pino(opcionesPino, destino);
  const leer = () => lineas.map((linea) => JSON.parse(linea));
  return { logger, leer };
}

function enPeticion(requestId: string, fn: () => void) {
  const req = { headers: { "x-request-id": requestId } } as unknown as Request;
  const res = { setHeader: () => undefined } as unknown as Response;
  requestIdMiddleware(req, res, fn);
}

describe("formato de los logs", () => {
  it("escribe timestamp, level, service, request_id y message", () => {
    const { logger, leer } = crearLogger();

    enPeticion("prueba-123", () => logger.info("hola"));

    const [log] = leer();
    expect(Object.keys(log)).toEqual([
      "level",
      "timestamp",
      "service",
      "request_id",
      "message",
    ]);
    expect(log).toMatchObject({
      level: "info",
      service: "backend",
      request_id: "prueba-123",
      message: "hola",
    });
    expect(log.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it.each([
    ["warn", "warning"],
    ["error", "error"],
  ] as const)("escribe el nivel %s como %s", (metodo, nivel) => {
    const { logger, leer } = crearLogger();

    logger[metodo]("algo pasó");

    expect(leer()[0].level).toBe(nivel);
  });

  it("usa request_id null fuera de una petición", () => {
    const { logger, leer } = crearLogger();

    logger.info("arranque");

    expect(leer()[0].request_id).toBeNull();
  });

  it("no incluye pid ni hostname", () => {
    const { logger, leer } = crearLogger();

    logger.info("hola");

    expect(leer()[0]).not.toHaveProperty("pid");
    expect(leer()[0]).not.toHaveProperty("hostname");
  });

  it("con el logger de pino-http (request_id ligado) no repite request_id", () => {
    const { logger, leer } = crearLogger();
    const lineas: string[] = [];
    const original = JSON.parse;
    // Se revisa el texto crudo: JSON.parse se quedaría con la última clave repetida.
    jest.spyOn(JSON, "parse").mockImplementation((texto, ...resto) => {
      lineas.push(texto);
      return original(texto, ...resto);
    });

    logger.child({ request_id: "prueba-789" }).info("en una petición");
    const [log] = leer();

    expect(log.request_id).toBe("prueba-789");
    expect(lineas[0].match(/"request_id"/g)).toHaveLength(1);
    jest.restoreAllMocks();
  });
});
