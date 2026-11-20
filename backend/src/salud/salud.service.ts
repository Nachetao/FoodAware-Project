import { readFileSync } from "fs";
import { join } from "path";
import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { firstValueFrom } from "rxjs";
import { SERVICIO } from "../observabilidad/logger.config";
import {
  DetalleFastApi,
  DetallePostgresql,
  EstadoDependencia,
  EstadoSalud,
  RespuestaSalud,
} from "./salud.dto";

// Un health check debe responder rápido aunque una dependencia esté colgada.
export const TIMEOUT_SALUD_MS = 2000;

const VERSION: string = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf8"),
).version;

/**
 * Commit del repositorio que se está ejecutando, como en el python-service:
 * Render define RENDER_GIT_COMMIT en cada despliegue; en otro lado se puede
 * pasar GIT_COMMIT. Sin ninguna de las dos (o vacías), null.
 */
export function commitDesplegado(
  env: Record<string, string | undefined>,
): string | null {
  for (const variable of ["RENDER_GIT_COMMIT", "GIT_COMMIT"]) {
    const valor = env[variable]?.trim();
    if (valor) {
      return valor;
    }
  }
  return null;
}

@Injectable()
export class SaludService {
  private readonly pythonApiUrl: string;
  // Se lee una vez: no cambia mientras el proceso corre.
  private readonly commit = commitDesplegado(process.env);

  constructor(
    private readonly dataSource: DataSource,
    private readonly httpService: HttpService,
    configService: ConfigService,
  ) {
    this.pythonApiUrl = configService.get<string>(
      "PYTHON_API_URL",
      "http://localhost:8000",
    );
  }

  async verificar(): Promise<RespuestaSalud> {
    const [postgresql, fastapi] = await Promise.all([
      this.verificarPostgresql(),
      this.verificarFastApi(),
    ]);
    const dependencias = {
      postgresql: postgresql.error ? "error" : "ok",
      fastapi: estadoFastApi(fastapi),
    } satisfies Record<string, EstadoDependencia>;

    // Sin PostgreSQL no hay respaldo ni guardado: error. FastAPI caído o
    // degradado solo degrada, porque la búsqueda responde desde la base.
    let estado: EstadoSalud = "ok";
    if (dependencias.postgresql === "error") {
      estado = "error";
    } else if (dependencias.fastapi !== "ok") {
      estado = "degradado";
    }

    return {
      estado,
      servicio: SERVICIO,
      version: VERSION,
      commit: this.commit,
      verificado_en: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      dependencias,
      detalle: { postgresql, fastapi },
    };
  }

  private async verificarPostgresql(): Promise<DetallePostgresql> {
    const inicio = performance.now();
    try {
      await conTimeout(this.dataSource.query("SELECT 1"), TIMEOUT_SALUD_MS);
      return { latencia_ms: msDesde(inicio), error: null };
    } catch (error) {
      return { latencia_ms: null, error: error.message };
    }
  }

  private async verificarFastApi(): Promise<DetalleFastApi> {
    const inicio = performance.now();
    try {
      // FastAPI responde 503 con el mismo cuerpo cuando su estado es error.
      const { data } = await firstValueFrom(
        this.httpService.get<{ estado?: EstadoSalud }>(
          `${this.pythonApiUrl}/health`,
          { timeout: TIMEOUT_SALUD_MS, validateStatus: () => true },
        ),
      );
      return {
        estado: data?.estado ?? null,
        latencia_ms: msDesde(inicio),
        error: data?.estado ? null : "Respuesta sin estado",
      };
    } catch (error) {
      return {
        estado: null,
        latencia_ms: null,
        error: error.code ?? error.message,
      };
    }
  }
}

function estadoFastApi(detalle: DetalleFastApi): EstadoDependencia {
  if (detalle.estado === "ok" || detalle.estado === "degradado") {
    return detalle.estado;
  }
  return "error";
}

function msDesde(inicio: number): number {
  return Math.round((performance.now() - inicio) * 10) / 10;
}

function conTimeout<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let temporizador: NodeJS.Timeout;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(
      () => rechazar(new Error(`Sin respuesta en ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promesa, limite]).finally(() =>
    clearTimeout(temporizador),
  );
}
