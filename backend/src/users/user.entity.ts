import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";
import { AllergenCode } from "../products/contrato/enums";
import { Rol } from "./rol";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "text" })
  nombre: string;

  @Column({ type: "text", unique: true })
  correo: string;

  @Column({ type: "text" })
  password: string;

  // Códigos del contrato (AllergenCode), nunca texto libre.
  @Column({ type: "text", array: true, default: () => "'{}'" })
  alergias: AllergenCode[];

  // Viaja en el JWT y se compara con este valor en cada petición.
  @Column({
    type: "enum",
    enum: Rol,
    enumName: "rol_usuario",
    default: Rol.USUARIO,
  })
  rol: Rol;
}
