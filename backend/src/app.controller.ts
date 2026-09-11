import { Controller, Get } from "@nestjs/common";
import { AppService } from "./app.service";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get("health")
  getHealth() {
    return { status: "ok", service: "foodaware-backend" };
  }

  // @Post("food/clasificar")
  // async clasificarFood(@Body() body: any) {
  //   // Reenvía la petición al servicio de Python
  //   return this.appService.clasificarEnPython(body);
  // }
}
