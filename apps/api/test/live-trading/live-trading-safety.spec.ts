import { ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { ExchangeEnvironment } from "../../src/exchange/domain/exchange.types";
import { LiveTradingConfigService } from "../../src/modules/live-trading/application/live-trading-config.service";

function service(values: Record<string, unknown>): LiveTradingConfigService {
  return new LiveTradingConfigService(new ConfigService(values));
}

describe("Phase 9 execution safety gates", () => {
  it("starts with the global kill switch active", () => {
    const config = service({ TRADING_MODE: "DEMO" });
    expect(() => config.assertExecutionAllowed(ExchangeEnvironment.TESTNET)).toThrow(ServiceUnavailableException);
  });

  it("allows testnet execution only when the global gate is explicit", () => {
    const config = service({ TRADING_MODE: "DEMO", GLOBAL_TRADING_ENABLED: true });
    expect(() => config.assertExecutionAllowed(ExchangeEnvironment.TESTNET)).not.toThrow();
    expect(() => config.assertExecutionAllowed(ExchangeEnvironment.PRODUCTION)).toThrow(ForbiddenException);
  });

  it("requires both LIVE mode and the dedicated live flag for production", () => {
    const blocked = service({ TRADING_MODE: "LIVE", GLOBAL_TRADING_ENABLED: true, LIVE_TRADING_ENABLED: false });
    expect(() => blocked.assertExecutionAllowed(ExchangeEnvironment.PRODUCTION)).toThrow(ForbiddenException);
    const enabled = service({ TRADING_MODE: "LIVE", GLOBAL_TRADING_ENABLED: true, LIVE_TRADING_ENABLED: true });
    expect(() => enabled.assertExecutionAllowed(ExchangeEnvironment.PRODUCTION)).not.toThrow();
    expect(() => enabled.assertExecutionAllowed(ExchangeEnvironment.DEMO)).toThrow(ForbiddenException);
  });

  it("cannot be re-enabled after the runtime kill switch is activated", () => {
    const config = service({ TRADING_MODE: "DEMO", GLOBAL_TRADING_ENABLED: true });
    config.kill();
    expect(() => config.assertExecutionAllowed(ExchangeEnvironment.DEMO)).toThrow(ServiceUnavailableException);
  });
});
