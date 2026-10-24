import { ConflictException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { User } from "./user.entity";
import { CreateUserDto } from "./dto/create-user.dto";

/** Usuario sin el hash de la contraseña, para responder al cliente. */
export type UsuarioPublico = Omit<User, "password">;

// Código de PostgreSQL para una violación de UNIQUE.
const VIOLACION_UNIQUE = "23505";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async createTestUser({
    nombre,
    correo,
    password,
    alergias,
  }: CreateUserDto): Promise<UsuarioPublico> {
    if (await this.findByCorreo(correo)) {
      throw new ConflictException("Ya existe un usuario con ese correo");
    }

    const newUser = this.userRepository.create({
      nombre,
      correo,
      password: await bcrypt.hash(password, 10),
      alergias: alergias ?? [],
    });

    try {
      const guardado = await this.userRepository.save(newUser);
      // Lista explícita: un campo nuevo de User no se expone por accidente.
      return {
        id: guardado.id,
        nombre: guardado.nombre,
        correo: guardado.correo,
        alergias: guardado.alergias,
      };
    } catch (error) {
      // Dos registros simultáneos con el mismo correo: lo resuelve el UNIQUE.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === VIOLACION_UNIQUE
      ) {
        throw new ConflictException("Ya existe un usuario con ese correo");
      }
      throw error;
    }
  }

  async findByCorreo(correo: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { correo } });
  }
}
