import { HttpService } from "@nestjs/axios";
import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { lastValueFrom } from "rxjs";

@Injectable()
export class AppService {
  constructor(private readonly httpService: HttpService) {}

  async clasificarEnPython(data: any) {
    const pythonUrl = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";
    try {
      const response = await lastValueFrom(
        this.httpService.post(`${pythonUrl}/clasificar-alimento`, data),
      );
      return response.data;
    } catch (error) {
      throw new HttpException(
        "Error al comunicarse con el microservicio de Python",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
