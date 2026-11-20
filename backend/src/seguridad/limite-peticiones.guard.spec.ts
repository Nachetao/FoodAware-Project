import {
  Controller,
  Get,
  INestApplication,
  Logger,
  Post,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import {
  LIMITE_LOGIN_POR_DEFECTO,
  LIMITE_PUBLICO_POR_DEFECTO,
  LimitarPeticiones,
  leerLimite,
  opcionesLimitePeticiones,
} from "./limite-peticiones";
import { MENSAJE_LIMITE } from "./limite-peticiones.guard";

@Controller("prueba")
class ControladorDePrueba {
  @LimitarPeticiones("login")
  @Post("login")
  login() {
    return { ok: true };
  }

  @LimitarPeticiones("publico")
  @Get("publica")
  publica() {
    return { ok: true };
  }

  @Get("sin-limite")
  sinLimite() {
    return { ok: true };
  }
}

describe("leerLimite", () => {
  it.each([
    [undefined, 5],
    ["", 5],
    ["  ", 5],
    ["abc", 5],
    ["0", 5],
    ["-3", 5],
    ["2.5", 5],
    ["12", 12],
  ])("con %p usa %p", (crudo, esperado) => {
    expect(leerLimite(crudo, 5)).toBe(esperado);
  });
});

describe("LimitePeticionesGuard", () => {
  let app: INestApplication;
  let url: string;
  let ipSiguiente = 1;
  const entornoOriginal = { ...process.env };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(opcionesLimitePeticiones)],
      controllers: [ControladorDePrueba],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    // Como configurar-app.ts: la IP sale de X-Forwarded-For.
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/prueba`;
  });

  afterAll(() => app.close());

  afterEach(() => {
    process.env = { ...entornoOriginal };
    jest.restoreAllMocks();
  });

  /** Una IP nueva por prueba: cada una empieza con el contador en cero. */
  function nuevaIp(): string {
    return `203.0.113.${ipSiguiente++}`;
  }

  function pedir(ruta: string, ip: string, metodo = "GET") {
    return fetch(`${url}/${ruta}`, {
      method: metodo,
      headers: { "X-Forwarded-For": ip },
    });
  }

  async function pedirVeces(
    n: number,
    ruta: string,
    ip: string,
    metodo?: string,
  ) {
    const estados: number[] = [];
    for (let i = 0; i < n; i++) {
      estados.push((await pedir(ruta, ip, metodo)).status);
    }
    return estados;
  }

  it(`el login permite ${LIMITE_LOGIN_POR_DEFECTO} intentos por minuto y el sexto responde 429`, async () => {
    const ip = nuevaIp();

    const estados = await pedirVeces(
      LIMITE_LOGIN_POR_DEFECTO,
      "login",
      ip,
      "POST",
    );
    const sexto = await pedir("login", ip, "POST");

    expect(estados.every((estado) => estado === 201)).toBe(true);
    expect(sexto.status).toBe(429);
    expect(await sexto.json()).toEqual({
      statusCode: 429,
      message: MENSAJE_LIMITE,
      error: "Too Many Requests",
    });
    expect(Number(sexto.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("cuenta por IP: otra IP sigue pudiendo entrar", async () => {
    const bloqueada = nuevaIp();
    await pedirVeces(LIMITE_LOGIN_POR_DEFECTO + 1, "login", bloqueada, "POST");

    const otra = await pedir("login", nuevaIp(), "POST");

    expect(otra.status).toBe(201);
  });

  it("cada ruta lleva su propio contador", async () => {
    const ip = nuevaIp();
    await pedirVeces(LIMITE_LOGIN_POR_DEFECTO + 1, "login", ip, "POST");

    const publica = await pedir("publica", ip);

    expect(publica.status).toBe(200);
  });

  it(`las rutas públicas permiten ${LIMITE_PUBLICO_POR_DEFECTO} por minuto`, async () => {
    const ip = nuevaIp();

    const estados = await pedirVeces(LIMITE_PUBLICO_POR_DEFECTO, "publica", ip);
    const siguiente = await pedir("publica", ip);

    expect(estados.every((estado) => estado === 200)).toBe(true);
    expect(siguiente.status).toBe(429);
  });

  it("LIMITE_LOGIN_POR_MINUTO cambia el límite sin reiniciar", async () => {
    process.env.LIMITE_LOGIN_POR_MINUTO = "2";
    const ip = nuevaIp();

    const estados = await pedirVeces(3, "login", ip, "POST");

    expect(estados).toEqual([201, 201, 429]);
  });

  it("LIMITE_PUBLICO_POR_MINUTO cambia el límite de las rutas públicas", async () => {
    process.env.LIMITE_PUBLICO_POR_MINUTO = "1";
    const ip = nuevaIp();

    const estados = await pedirVeces(2, "publica", ip);

    expect(estados).toEqual([200, 429]);
  });

  it("con un valor inválido en la variable usa el límite por defecto", async () => {
    process.env.LIMITE_LOGIN_POR_MINUTO = "muchos";
    const ip = nuevaIp();

    const estados = await pedirVeces(
      LIMITE_LOGIN_POR_DEFECTO + 1,
      "login",
      ip,
      "POST",
    );

    expect(estados.filter((estado) => estado === 429)).toHaveLength(1);
    expect(estados.at(-1)).toBe(429);
  });

  it("las rutas sin @LimitarPeticiones no tienen límite", async () => {
    process.env.LIMITE_PUBLICO_POR_MINUTO = "1";
    const ip = nuevaIp();

    const estados = await pedirVeces(5, "sin-limite", ip);

    expect(estados.every((estado) => estado === 200)).toBe(true);
  });

  it("registra el 429 con la ruta y sin la IP", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    process.env.LIMITE_LOGIN_POR_MINUTO = "1";
    const ip = nuevaIp();

    await pedirVeces(2, "login", ip, "POST");

    expect(warn).toHaveBeenCalledTimes(1);
    const mensaje = String(warn.mock.calls[0][0]);
    expect(mensaje).toContain(
      "limite_peticiones_superado en POST /prueba/login",
    );
    expect(mensaje).not.toContain(ip);
  });
});
