import "reflect-metadata";
import { NestFactory } from "@nestjs/core";

async function main(): Promise<void> {
  process.env.REFLECTION_ENABLED = "false";
  process.env.LIVE_POSITION_SYNC_ENABLED = "false";
  process.env.CLI_DISABLE_SCHEDULERS = "true";
  process.env.TRADE_LEDGER_BACKFILL = "true";
  const userId = process.argv[2];
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error("Usage: node dist/scripts/backfill-trade-ledger.js <user-uuid>");
  }
  const [{ AppModule }, { PrismaService }, { LiveTradingService }] = await Promise.all([
    import("../app.module"),
    import("../database/prisma.service"),
    import("../modules/live-trading/application/live-trading.service"),
  ]);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });
  try {
    const prisma = app.get(PrismaService);
    const liveTrading = app.get(LiveTradingService);
    const connections = await prisma.exchangeConnection.findMany({
      where: { userId, isEnabled: true, isVerified: true },
      orderBy: { createdAt: "asc" },
    });
    const results = [];
    for (const connection of connections) {
      const sync = await liveTrading.sync(userId, connection.id, {});
      results.push({
        connectionId: connection.id,
        provider: connection.provider,
        sync,
        backfill: await liveTrading.backfillTradeLedger(userId, connection.id, {}),
      });
    }
    const [fills, closedTrades, archives] = await Promise.all([
      prisma.exchangeFill.count({ where: { userId } }),
      prisma.closedTrade.count({ where: { userId } }),
      prisma.knowledgeArchive.count({ where: { userId } }),
    ]);
    process.stdout.write(`${JSON.stringify({ connections: results, fills, closedTrades, archives }, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
