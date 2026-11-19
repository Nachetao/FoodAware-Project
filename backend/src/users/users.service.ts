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
import { ActualizarPerfilDto } from "./dto/actualizar-perfil.dto";
import { AllergenCode } from "../products/contrato/enums";
import { Rol } from "./rol";

/** Usuario sin el hash de la contraseña, para responder al cliente. */
export type UsuarioPublico = Omit<User, "password">;

/**
 * Usuario en la lista de administración: sin contraseña y sin datos de salud
 * (alergias), que solo ve su dueño.
 */
export type UsuarioResumen = Pick<User, "id" | "nombre" | "correo" | "rol">;

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
      dietas: [],
      modo_estricto: false,
      // Explícito: el registro nunca crea administradores.
      rol: Rol.USUARIO,
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

  /** Usuario por id, o null si ya no existe (por ejemplo, si borró su cuenta). */
  async buscarPorId(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  /** Todos los usuarios para la administración, ordenados por nombre. */
  async listar(): Promise<UsuarioResumen[]> {
    const usuarios = await this.userRepository.find({
      order: { nombre: "ASC", correo: "ASC" },
    });
    return usuarios.map(({ id, nombre, correo, rol }) => ({
      id,
      nombre,
      correo,
      rol,
    }));
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

  /**
   * Cambia solo los campos que vienen (ya validados por ActualizarPerfilDto).
   * Las listas reemplazan a las anteriores, sin repetir.
   */
  async actualizarPerfil(
    id: string,
    { nombre, alergias, dietas, modo_estricto }: ActualizarPerfilDto,
  ): Promise<UsuarioPublico> {
    const usuario = await this.buscarOFallar(id);
    if (nombre !== undefined) {
      usuario.nombre = nombre;
    }
    if (alergias !== undefined) {
      usuario.alergias = [...new Set(alergias)];
    }
    if (dietas !== undefined) {
      usuario.dietas = [...new Set(dietas)];
    }
    if (modo_estricto !== undefined) {
      usuario.modo_estricto = modo_estricto;
    }
    return aUsuarioPublico(await this.userRepository.save(usuario));
  }

  /**
   * Borra la cuenta: la fila de users es el único dato asociado al usuario
   * (los alimentos analizados y los productos no guardan quién los consultó).
   * Desde ese momento sus tokens responden 401.
   */
  async borrarCuenta(id: string): Promise<void> {
    const { affected } = await this.userRepository.delete({ id });
    if (!affected) {
      throw new NotFoundException("Usuario no encontrado");
    }
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
    dietas: usuario.dietas,
    modo_estricto: usuario.modo_estricto,
    rol: usuario.rol,
  };
}
