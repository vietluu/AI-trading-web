import { Controller, Get } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { HealthResponse } from "@platform/shared";

import { HealthService } from "./health.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: "Check API, PostgreSQL, and Redis health" })
  @ApiOkResponse({
    description: "All foundational services are available.",
    schema: {
      example: {
        status: "ok",
        timestamp: "2026-07-31T00:00:00.000Z",
        services: {
          database: { status: "up", latencyMs: 2 },
          redis: { status: "up", latencyMs: 1 },
        },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: "A foundational dependency is unavailable.",
  })
  getHealth(): Promise<HealthResponse> {
    return this.healthService.getHealth();
  }
}
