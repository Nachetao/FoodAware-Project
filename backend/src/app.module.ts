import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { IaModule } from './ia/ia.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../.env', // Hacerlo disponible en todos los módulos sin importarlo nuevamente
    }),
    HttpModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST') === 'db' && process.env.NODE_ENV !== 'production' ? 'localhost' : configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<string>('DB_HOST') === 'db' && process.env.NODE_ENV !== 'production' ? 5433 : configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USER'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: true, // Habilitado temporalmente para el MVP
      }),
    }),
    UsersModule,
    IaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
