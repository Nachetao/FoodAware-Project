import { Controller } from "@nestjs/common";
import { AppService } from "./app.service";

// GET /api/health está en SaludModule.
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }
}
