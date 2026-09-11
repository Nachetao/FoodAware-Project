import { Test, TestingModule } from "@nestjs/testing";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { HttpService } from "@nestjs/axios";

describe("AppController", () => {
  let controller: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: HttpService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  describe("getHealth", () => {
    it('should return status "ok" and service "foodaware-backend"', () => {
      const result = controller.getHealth();
      expect(result).toEqual({
        status: "ok",
        service: "foodaware-backend",
      });
    });
  });
});
