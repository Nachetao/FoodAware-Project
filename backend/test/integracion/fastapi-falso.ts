import { createServer, IncomingMessage, ServerResponse } from "http";
import { AddressInfo, Socket } from "net";

export interface PeticionRecibida {
  ruta: string;
  query: URLSearchParams;
  requestId: string | undefined;
}

/** Respuesta JSON con status, o "colgado" para no responder nunca. */
export type Respuesta = { status: number; cuerpo: unknown } | "colgado";
type Manejador = (peticion: PeticionRecibida) => Respuesta;

const SALUD_OK: Respuesta = {
  status: 200,
  cuerpo: {
    estado: "ok",
    servicio: "python-service",
    version: "0.1.0",
    verificado_en: "2026-10-20T14:30:00Z",
    dependencias: { cache: "ok", indice: "ok", openfoodfacts: "ok" },
  },
};

/**
 * Servidor HTTP que imita a FastAPI (GET /search y GET /health) con
 * respuestas configurables por test. Registra cada petición recibida.
 */
export class FastApiFalso {
  readonly peticiones: PeticionRecibida[] = [];
  private manejadores = new Map<string, Manejador>();
  private servidor = createServer((req, res) => this.atender(req, res));
  private sockets = new Set<Socket>();
  private puerto = 0;

  constructor() {
    this.servidor.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
  }

  get url(): string {
    return `http://127.0.0.1:${this.puerto}`;
  }

  async iniciar(): Promise<void> {
    await this.escuchar(0);
    this.puerto = (this.servidor.address() as AddressInfo).port;
  }

  /** Deja de aceptar conexiones en el mismo puerto: simula FastAPI caído. */
  async apagar(): Promise<void> {
    if (!this.servidor.listening) return;
    this.cortarConexiones();
    await new Promise<void>((listo) => this.servidor.close(() => listo()));
  }

  async encender(): Promise<void> {
    if (!this.servidor.listening) await this.escuchar(this.puerto);
  }

  /** Configura la respuesta de una ruta ("/search" o "/health"). */
  responder(ruta: string, manejador: Manejador): void {
    this.manejadores.set(ruta, manejador);
  }

  intentos(ruta: string): number {
    return this.peticiones.filter((p) => p.ruta === ruta).length;
  }

  reiniciar(): void {
    this.peticiones.length = 0;
    this.manejadores.clear();
    this.cortarConexiones();
  }

  private atender(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", this.url);
    const peticion: PeticionRecibida = {
      ruta: url.pathname,
      query: url.searchParams,
      requestId: req.headers["x-request-id"] as string | undefined,
    };
    this.peticiones.push(peticion);

    const porDefecto: Manejador = () =>
      peticion.ruta === "/health"
        ? SALUD_OK
        : { status: 404, cuerpo: { detail: "Not Found" } };
    const respuesta = (this.manejadores.get(peticion.ruta) ?? porDefecto)(
      peticion,
    );
    if (respuesta === "colgado") return;

    res.writeHead(respuesta.status, {
      "Content-Type": "application/json",
      "X-Request-ID": peticion.requestId ?? "generado-por-fastapi",
    });
    res.end(JSON.stringify(respuesta.cuerpo));
  }

  private escuchar(puerto: number): Promise<void> {
    return new Promise((listo) =>
      this.servidor.listen(puerto, "127.0.0.1", () => listo()),
    );
  }

  private cortarConexiones(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }
}
