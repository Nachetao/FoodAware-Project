import { Controller, Get } from '@nestjs/common';
import { IaAnalysisService } from './ia.service';

@Controller('food')
export class IaController {
  constructor(private readonly iaAnalysisService: IaAnalysisService) {}

  @Get('test-ia')
  async testIa() {
    const nombre = 'Barrita energética';
    const ingredientes = ['avena', 'maní', 'azúcar', 'miel'];
    
    const respuesta = await this.iaAnalysisService.analizarProducto(nombre, ingredientes);
    
    return {
      message: 'Prueba de integración exitosa NestJS -> FastAPI',
      resultado: respuesta,
    };
  }
}
