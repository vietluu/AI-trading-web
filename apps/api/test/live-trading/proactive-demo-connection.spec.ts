import { describe, expect, it, vi } from "vitest";
import { ExchangeEnvironment, ExchangeProvider } from "../../src/exchange/domain/exchange.types";
import { LiveTradingService } from "../../src/modules/live-trading/application/live-trading.service";

const production = {
  id: "production", provider: ExchangeProvider.BINANCE_FUTURES,
  environment: ExchangeEnvironment.PRODUCTION, isEnabled: true, isVerified: true,
};
const demo = {
  ...production, id: "demo", provider: ExchangeProvider.OKX_FUTURES,
  environment: ExchangeEnvironment.DEMO,
};

function build(connectionsList: typeof production[]) {
  const connections = {
    list: vi.fn().mockResolvedValue(connectionsList),
    // Stop before external exchange I/O after recording which connection was selected.
    instrument: vi.fn().mockRejectedValue(new Error("fixture exchange unavailable")),
  };
  const service = new LiveTradingService(
    {} as never, connections as never,
    { values: { mode: "LIVE" } } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  return { service, connections };
}

const assessment = {
  userId: "user-1", pipelineRunId: "run-1", symbol: "BTC-USDT",
  provider: ExchangeProvider.BINANCE_FUTURES,
  decision: {} as never, requiredEnvironment: "DEMO" as const,
};

describe("proactive demo connection selection", () => {
  it("does not fall back to production when DEMO is required", async () => {
    const { service, connections } = build([production]);
    expect(await service.assessPipelineDecision(assessment).catch(() => ({ outcome: "EXCHANGE_CALLED" }))).toMatchObject({
      outcome: "NO_ELIGIBLE_EXCHANGE_CONNECTION",
    });
    expect(connections.instrument).not.toHaveBeenCalled();
  });

  it("pins a verified DEMO connection even when global trading mode is LIVE", async () => {
    const { service, connections } = build([production, demo]);
    await expect(service.assessPipelineDecision(assessment)).rejects.toThrow("fixture exchange unavailable");
    expect(connections.instrument).toHaveBeenCalledWith("user-1", "demo", "BTC-USDT", {});
  });
  it.each(["missing-demo", "production"])(
    "never substitutes production when the pinned demo connection is %s",
    async (connectionId) => {
      const service = new LiveTradingService(
        { riskAssessment: { findUnique: () => Promise.resolve({ id: "assessment-1", userId: "user-1", approved: true, connectionId }) } } as never,
        { list: () => Promise.resolve([production]) } as never,
        { values: { mode: "DEMO", runtimeEnabled: true } } as never,
        {} as never, {} as never, {} as never, {} as never, {} as never,
      );
      const execute = vi.spyOn(service, "execute").mockResolvedValue({} as never);
      const result = await service.executePipeline("user-1", "run-1", { requiredEnvironment: "DEMO" });
      expect(result).toEqual({ outcome: "NO_ELIGIBLE_EXCHANGE_CONNECTION" });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("strictly requires OKX_FUTURES DEMO for RECOVERY_RECLAIM and rejects Binance testnet", async () => {
    const binanceTestnet = {
      ...production,
      id: "binance-testnet",
      provider: ExchangeProvider.BINANCE_FUTURES,
      environment: ExchangeEnvironment.TESTNET,
    };
    const { service, connections } = build([binanceTestnet]);
    const recoveryAssessment = {
      ...assessment,
      tradePlanContext: {
        proactive: {
          thesis: { setup: "RECOVERY_RECLAIM" },
        },
      } as never,
    };

    const result = await service.assessPipelineDecision(recoveryAssessment);
    expect(result).toMatchObject({ outcome: "NO_ELIGIBLE_EXCHANGE_CONNECTION" });
    expect(connections.instrument).not.toHaveBeenCalled();
  });
});

