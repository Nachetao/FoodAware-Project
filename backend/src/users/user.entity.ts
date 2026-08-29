import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text', unique: true })
  correo: string;

  @Column({ type: 'text' })
  password: string;

  @Column({ type: 'simple-array', nullable: true })
  alergias: string[];
}
