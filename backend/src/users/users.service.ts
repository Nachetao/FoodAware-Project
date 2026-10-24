import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { User } from "./user.entity";
import { CreateUserDto } from "./dto/create-user.dto";
import { AllergenCode } from "../products/contrato/enums";

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
      return aUsuarioPublico(await this.userRepository.save(newUser));
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

  /** Perfil del usuario, sin password; 404 si ya no existe. */
  async perfil(id: string): Promise<UsuarioPublico> {
    return aUsuarioPublico(await this.buscarOFallar(id));
  }

  /** Reemplaza las alergias (ya validadas contra AllergenCode), sin repetir. */
  async actualizarAlergias(
    id: string,
    alergias: AllergenCode[],
  ): Promise<UsuarioPublico> {
    const usuario = await this.buscarOFallar(id);
    usuario.alergias = [...new Set(alergias)];
    return aUsuarioPublico(await this.userRepository.save(usuario));
  }

  private async buscarOFallar(id: string): Promise<User> {
    const usuario = await this.userRepository.findOne({ where: { id } });
    if (!usuario) {
      throw new NotFoundException("Usuario no encontrado");
    }
    return usuario;
  }
}

// Lista explícita: un campo nuevo de User no se expone por accidente.
function aUsuarioPublico(usuario: User): UsuarioPublico {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    correo: usuario.correo,
    alergias: usuario.alergias,
  };
}
