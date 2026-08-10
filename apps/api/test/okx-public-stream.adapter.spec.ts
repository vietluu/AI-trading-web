import { describe, expect, it, vi } from "vitest";
import { MarketEventType } from "../src/market-data/domain/market-data.enums";
import type {
  NormalizedMarketEvent,
  NormalizedTicker,
} from "../src/market-data/domain/market-data.types";
import { OkxPublicStreamAdapter } from "../src/market-data/infrastructure/streams/okx-public-stream.adapter";

describe("OkxPublicStreamAdapter", () => {
  it("derives 24h price change from last and open24h", () => {
    const adapter = new OkxPublicStreamAdapter({
      get: vi.fn().mockReturnValue(undefined),
    } as never);
    let emitted: NormalizedMarketEvent | undefined;
    adapter.onEvent((event) => {
      emitted = event;
    });

    (adapter as unknown as { handleMessage(message: string): void }).handleMessage(
      JSON.stringify({
        arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
        data: [{
          instId: "BTC-USDT-SWAP",
          last: "102",
          open24h: "100",
          bidPx: "101.9",
          askPx: "102.1",
          high24h: "103",
          low24h: "99",
          vol24h: "1234",
          volCcy24h: "125000",
          ts: "1700000000000",
        }],
      }),
    );

    expect(emitted?.type).toBe(MarketEventType.TICKER_UPDATED);
    expect(emitted?.payload).toMatchObject({
      symbol: "BTC-USDT",
      priceChange24h: "2",
      priceChangePercent24h: "2",
    } satisfies Partial<NormalizedTicker>);
  });
});
