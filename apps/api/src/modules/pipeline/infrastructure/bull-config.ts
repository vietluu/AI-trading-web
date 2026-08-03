import { ConfigService } from "@nestjs/config";

export function createBullRootConfig(config: ConfigService) {
  return {
    connection: {
      url: config.get<string>("REDIS_URL") || "redis://localhost:6379",
    },
  };
}
