import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";
import { AllergenCode, DietLabel } from "../products/contrato/enums";
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

  // Códigos DietLabel del contrato. Se envían al motor con las alergias.
  @Column({ type: "text", array: true, default: () => "'{}'" })
  dietas: DietLabel[];

  // true: las trazas, los indicios y los datos insuficientes hacen el
  // producto no_apto en vez de apto_con_advertencia.
  @Column({ type: "boolean", default: false })
  modo_estricto: boolean;

  // Viaja en el JWT y se compara con este valor en cada petición.
  @Column({
    type: "enum",
    enum: Rol,
    enumName: "rol_usuario",
    default: Rol.USUARIO,
  })
  rol: Rol;
}
