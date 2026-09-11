import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { User } from "./user.entity";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async createTestUser(userData: Partial<User>): Promise<User> {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const newUser = this.userRepository.create({
      ...userData,
      password: hashedPassword,
    });
    return this.userRepository.save(newUser);
  }

  async findByCorreo(correo: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { correo } });
  }
}

