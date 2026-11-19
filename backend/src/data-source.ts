import { DataSource } from "typeorm";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

export default new DataSource({
  type: "postgres",
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? "5432", 10),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // DB_SSL=true al conectarse desde fuera a una base que exige TLS (por
  // ejemplo, la de staging en Render para el script admin:asignar).
  ssl: process.env.DB_SSL === "true",
  entities: [__dirname + "/**/*.entity{.ts,.js}"],
  migrations: [__dirname + "/migrations/*{.ts,.js}"],
  synchronize: false,
});
