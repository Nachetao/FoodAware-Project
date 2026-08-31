import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { firstValueFrom } from "rxjs";
import { Food } from "../foods/entities/food.entity";
import { User } from "../users/user.entity";

@Injectable()
export class IaAnalysisService {
  private readonly logger = new Logger(IaAnalysisService.name);
  private readonly pythonApiUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(Food)
    private readonly foodRepository: Repository<Food>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    this.pythonApiUrl = this.configService.get<string>(
      "PYTHON_API_URL",
      "http://localhost:8000",
    );
  }

  async analizarProducto(
    nombre: string,
    ingredientes: string[],
    userId?: string,
  ) {
    this.logger.log(
      `Enviando producto '${nombre}' para análisis a ${this.pythonApiUrl}...`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.pythonApiUrl}/analizar`, {
          nombre,
          ingredientes,
        }),
      );

      this.logger.log("Análisis recibido exitosamente.");
      const data = response.data;

      const newFood = this.foodRepository.create({
        nombre: data.producto,
        ingredientes: ingredientes,
        alergenosPresentes: data.veredicto.alergenos_detectados,
        esNutricionalmenteSaludable: data.veredicto.es_saludable,
      });

      const savedFood = await this.foodRepository.save(newFood);
      this.logger.log(`Alimento guardado en DB con ID: ${savedFood.id}`);

      let aptoParaConsumo = true;
      if (userId) {
        const user = await this.userRepository.findOne({
          where: { id: userId },
        });
        if (user && user.alergias && savedFood.alergenosPresentes) {
          const tieneAlergia = savedFood.alergenosPresentes.some((alergeno) =>
            user.alergias.includes(alergeno),
          );
          if (tieneAlergia) {
            aptoParaConsumo = false;
          }
        }
      }

      return {
        ...savedFood,
        aptoParaConsumo,
      };
    } catch (error) {
      this.logger.error(
        `Error de comunicación con el servicio de Python o al guardar: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Error al analizar el producto con IA o guardarlo en la base de datos",
      );
    }
  }
}
