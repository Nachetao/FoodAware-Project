import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("foods")
export class Food {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "text" })
  nombre: string;

  @Column({ type: "simple-array" })
  ingredientes: string[];

  @Column({ type: "simple-array", nullable: true })
  alergenosPresentes: string[];

  @Column({ type: "boolean" })
  esNutricionalmenteSaludable: boolean;
}
