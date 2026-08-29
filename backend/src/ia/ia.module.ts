import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { IaAnalysisService } from './ia.service';
import { IaController } from './ia.controller';

@Module({
  imports: [HttpModule], // Permite usar HttpService internamente
  providers: [IaAnalysisService],
  controllers: [IaController],
  exports: [IaAnalysisService], // Exportamos para que otros módulos lo usen a futuro
})
export class IaModule {}
