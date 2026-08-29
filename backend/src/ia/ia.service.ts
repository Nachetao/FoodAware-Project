import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class IaAnalysisService {
  private readonly logger = new Logger(IaAnalysisService.name);
  private readonly pythonApiUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.pythonApiUrl = this.configService.get<string>('PYTHON_API_URL', 'http://localhost:8000');
  }

  async analizarProducto(nombre: string, ingredientes: string[]) {
    this.logger.log(`Enviando producto '${nombre}' para análisis a ${this.pythonApiUrl}...`);
    
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.pythonApiUrl}/analizar`, {
          nombre,
          ingredientes,
        }),
      );
      
      this.logger.log('Análisis recibido exitosamente.');
      return response.data;
    } catch (error) {
      this.logger.error(`Error de comunicación con el servicio de Python: ${error.message}`);
      throw new InternalServerErrorException('Error al analizar el producto con IA');
    }
  }
}
