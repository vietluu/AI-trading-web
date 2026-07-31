import "reflect-metadata";

import { ConsoleLogger, Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";

async function bootstrap(): Promise<void> {
  const structuredLogger = new ConsoleLogger({
    colors: false,
    json: true,
    prefix: "api",
  });
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    logger: structuredLogger,
  });
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>("API_PORT");
  const allowedOrigins = configService.getOrThrow<string[]>("CORS_ORIGINS");

  app.useLogger(structuredLogger);
  app.setGlobalPrefix("api");
  app.enableCors({
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ): void {
      if (origin === undefined || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("AI Trading Platform API")
    .setDescription(
      "Foundation API for the cryptocurrency futures research platform.",
    )
    .setVersion("1.0")
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, swaggerDocument, {
    jsonDocumentUrl: "docs/json",
  });

  await app.listen(port, "0.0.0.0");
  Logger.log({
    event: "application_started",
    port,
    healthUrl: `http://localhost:${port}/api/health`,
    swaggerUrl: `http://localhost:${port}/docs`,
  });
}

void bootstrap();
