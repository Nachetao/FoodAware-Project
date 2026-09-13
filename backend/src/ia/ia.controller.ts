import { Controller, Get, Post, Body } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { IaAnalysisService } from "./ia.service";
import { User } from "../users/user.entity";
import { AnalizarProductoDto } from "./dto/analizar-producto.dto";

@Controller("food")
export class IaController {
  constructor(
    private readonly iaAnalysisService: IaAnalysisService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  @Post("analizar")
  async analizar(
    @Body() body: AnalizarProductoDto,
  ) {
    const { nombre, ingredientes, userId } = body;

    const resultado = await this.iaAnalysisService.analizarProducto(
      nombre,
      ingredientes,
      userId,
    );

    return {
      message: "Análisis completado",
      resultado,
    };
  }

  @Get("test-ia")
  async testIa() {
    const nombre = "Barrita energética";
    const ingredientes = ["avena", "maní", "azúcar", "miel"];

    const respuesta = await this.iaAnalysisService.analizarProducto(
      nombre,
      ingredientes,
    );

    return {
      message: "Prueba de integración exitosa NestJS -> FastAPI",
      resultado: respuesta,
    };
  }

  @Get("test-alergia")
  async testAlergia() {
    // 1. Crear un usuario de prueba (con un correo aleatorio para no violar constraint 'unique' si se llama varias veces)
    const randomEmail = `prueba-${Date.now()}@test.com`;
    const newUser = this.userRepository.create({
      nombre: "Usuario de Prueba",
      correo: randomEmail,
      password: "passwordFicticia123",
      alergias: ["maní"],
    });
    const savedUser = await this.userRepository.save(newUser);

    // 2. Analizar el producto pasándole el ID de este nuevo usuario
    const nombre = "Barrita energética";
    const ingredientes = ["avena", "maní", "azúcar", "miel"];

    const respuesta = await this.iaAnalysisService.analizarProducto(
      nombre,
      ingredientes,
      savedUser.id,
    );

    return {
      message: "Prueba de cruce de alergias NestJS",
      usuario: savedUser,
      resultado: respuesta,
    };
  }
}
