import { Injectable, Logger } from "@nestjs/common";
import { ParametrosBusqueda, RespuestaBusqueda } from "./contrato/busqueda";
import { FastApiClientService } from "./fastapi-client.service";
import { ProductsRepository } from "./products.repository";

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly fastApiClient: FastApiClientService,
    private readonly productsRepository: ProductsRepository,
  ) {}

  /** Busca en FastAPI y guarda los productos encontrados. */
  async buscar(
    params: ParametrosBusqueda,
    requestId: string,
  ): Promise<RespuestaBusqueda> {
    const respuesta = await this.fastApiClient.buscar(params, requestId);
    const productos = respuesta.resultados.map((r) => r.producto);

    // Si el guardado falla, la búsqueda igual responde con los datos de FastAPI.
    try {
      await this.productsRepository.guardar(productos);
    } catch (error) {
      this.logger.error(
        `[${requestId}] No se pudieron guardar ${productos.length} productos: ${error.message}`,
      );
    }

    return respuesta;
  }
}
