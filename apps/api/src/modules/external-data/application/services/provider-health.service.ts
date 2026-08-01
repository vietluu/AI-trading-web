import { Injectable } from '@nestjs/common';
import { ExternalDataHealthStatus, ExternalDataProvider } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';

@Injectable()
export class ProviderHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async recordAttempt(
    provider: ExternalDataProvider,
    durationMs: number,
    itemCount: number = 0,
    acceptedCount: number = 0,
    error?: { code?: string; message?: string },
  ) {
    const existing = await this.prisma.externalDataProviderHealth.findUnique({
      where: { provider },
    });

    const isSuccess = !error;
    const consecutiveFailures = isSuccess ? 0 : (existing?.consecutiveFailures || 0) + 1;

    let status: ExternalDataHealthStatus = ExternalDataHealthStatus.HEALTHY;
    if (!isSuccess) {
      if (error?.code === 'SOURCE_RATE_LIMITED') {
        status = ExternalDataHealthStatus.RATE_LIMITED;
      } else if (error?.code === 'SOURCE_AUTHENTICATION_FAILED') {
        status = ExternalDataHealthStatus.AUTHENTICATION_FAILED;
      } else if (consecutiveFailures >= 5) {
        status = ExternalDataHealthStatus.FAILED;
      } else {
        status = ExternalDataHealthStatus.DEGRADED;
      }
    }

    const currentLatency = existing?.averageLatencyMs || 0;
    const newLatency = currentLatency > 0 ? Math.round((currentLatency + durationMs) / 2) : durationMs;

    return this.prisma.externalDataProviderHealth.upsert({
      where: { provider },
      create: {
        provider,
        status,
        lastAttemptAt: new Date(),
        lastSuccessAt: isSuccess ? new Date() : undefined,
        lastItemAt: acceptedCount > 0 ? new Date() : undefined,
        consecutiveFailures,
        averageLatencyMs: newLatency,
        lastErrorCode: error?.code || null,
        itemsFetchedTotal: itemCount,
        itemsAcceptedTotal: acceptedCount,
      },
      update: {
        status,
        lastAttemptAt: new Date(),
        ...(isSuccess ? { lastSuccessAt: new Date() } : {}),
        ...(acceptedCount > 0 ? { lastItemAt: new Date() } : {}),
        consecutiveFailures,
        averageLatencyMs: newLatency,
        lastErrorCode: error?.code || null,
        itemsFetchedTotal: { increment: itemCount },
        itemsAcceptedTotal: { increment: acceptedCount },
      },
    });
  }

  async getAllProviderHealth() {
    const allProviders = Object.values(ExternalDataProvider);
    const records = await this.prisma.externalDataProviderHealth.findMany();
    const recordMap = new Map(records.map((r: any) => [r.provider, r]));

    return allProviders.map((provider) => {
      const record = recordMap.get(provider);
      if (record) return record;

      return {
        id: provider,
        provider,
        status: ['X', 'TELEGRAM', 'DISCORD'].includes(provider)
          ? ExternalDataHealthStatus.NOT_CONFIGURED
          : ExternalDataHealthStatus.HEALTHY,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastItemAt: null,
        consecutiveFailures: 0,
        averageLatencyMs: 0,
        lastErrorCode: null,
        rateLimitResetAt: null,
        itemsFetchedTotal: 0,
        itemsAcceptedTotal: 0,
        updatedAt: new Date(),
      };
    });
  }
}
