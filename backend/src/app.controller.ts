import { Body, Controller, Post } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('food')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('clasificar')
  async clasificarFood(@Body() body: any) {
    // Reenvía la petición al servicio de Python
    return this.appService.clasificarEnPython(body);
  }
}
