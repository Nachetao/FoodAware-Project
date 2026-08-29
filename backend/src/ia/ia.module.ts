import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IaAnalysisService } from './ia.service';
import { IaController } from './ia.controller';
import { Food } from '../foods/entities/food.entity';
import { User } from '../users/user.entity';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([Food, User]),
  ],
  providers: [IaAnalysisService],
  controllers: [IaController],
  exports: [IaAnalysisService], // Exportamos para que otros módulos lo usen a futuro
})
export class IaModule {}
