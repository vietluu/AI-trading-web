import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MarketDataModule } from "../src/market-data/market-data.module";

describe("AppModule", () => {
  it("registers the market-data HTTP routes and WebSocket gateway", () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as
      | unknown[]
      | undefined;

    expect(imports).toContain(MarketDataModule);
  });
});
