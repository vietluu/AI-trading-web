import { describe, expect, it, vi } from "vitest";
import { LiveTradingGateway } from "../../src/modules/live-trading/presentation/live-trading.gateway";

function client(cookie?: string) {
  return {
    id: "socket-1",
    handshake: {
      auth: {},
      query: {},
      headers: { ...(cookie ? { cookie } : {}), "user-agent": "test" },
      address: "127.0.0.1",
    },
    join: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe("LiveTradingGateway authorization", () => {
  it("ignores a client-supplied user id and uses the authenticated session owner", async () => {
    const trading = {
      dashboard: vi.fn().mockResolvedValue({ positions: [] }),
      sync: vi.fn().mockResolvedValue(undefined),
    };
    const sessions = { resolve: vi.fn().mockResolvedValue({ userId: "session-user" }) };
    const prisma = {
      exchangeConnection: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const gateway = new LiveTradingGateway(
      { get: vi.fn().mockReturnValue(trading) } as never,
      sessions as never,
      prisma as never,
      { subscribePositions: vi.fn() } as never,
    );
    const socket = client(`sid=${"a".repeat(43)}`);

    await gateway.handleSubscribe(socket as never, { userId: "other-user" });

    expect(socket.join).toHaveBeenCalledWith("dashboard:session-user");
    expect(trading.dashboard).toHaveBeenCalledWith("session-user", undefined);
    expect(trading.dashboard).not.toHaveBeenCalledWith("other-user", undefined);
  });

  it("disconnects an unauthenticated subscriber before loading a dashboard", async () => {
    const trading = { dashboard: vi.fn() };
    const gateway = new LiveTradingGateway(
      { get: vi.fn().mockReturnValue(trading) } as never,
      { resolve: vi.fn() } as never,
      {} as never,
      {} as never,
    );
    const socket = client();

    await gateway.handleSubscribe(socket as never, { userId: "target-user" });

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
    expect(trading.dashboard).not.toHaveBeenCalled();
  });
});
