process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/db";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "a-secret-session-key-minimum-32-chars-long";
process.env.ENCRYPTION_MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY || "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { MarketDataModule } from "../src/market-data/market-data.module";

describe("AppModule", () => {
  it("registers the market-data HTTP routes and WebSocket gateway", async () => {
    const { AppModule } = await import("../src/app.module");
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as
      | unknown[]
      | undefined;

    expect(imports).toContain(MarketDataModule);
  }, 30000);
});
