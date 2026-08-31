import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Food } from "./entities/food.entity";
import { FoodsService } from "./foods.service";
import { FoodsController } from "./foods.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Food])],
  controllers: [FoodsController],
  providers: [FoodsService],
  exports: [TypeOrmModule],
})
export class FoodsModule {}
