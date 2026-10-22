import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { SaludController } from "./salud.controller";
import { SaludService } from "./salud.service";

@Module({
  imports: [HttpModule],
  controllers: [SaludController],
  providers: [SaludService],
})
export class SaludModule {}
