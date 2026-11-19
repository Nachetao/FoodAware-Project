import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UsersController } from "./users.controller";
import { UsuariosController } from "./usuarios.controller";
import { UsuariosAdminController } from "./usuarios-admin.controller";
import { UsersService } from "./users.service";
import { User } from "./user.entity";

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController, UsuariosController, UsuariosAdminController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
