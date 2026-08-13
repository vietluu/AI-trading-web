import { Injectable } from "@nestjs/common";
import type { UserSetting } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../common/request-context";
import { PrismaService } from "../database/prisma.service";
import type { UpdateSettingsDto } from "./settings.dto";
import { SettingsRepository } from "./settings.repository";

@Injectable()
export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async get(userId: string) {
    return this.view(await this.repository.getOrCreate(userId));
  }

  async update(
    userId: string,
    dto: UpdateSettingsDto,
    context: RequestMetadata,
  ) {
    await this.repository.getOrCreate(userId);
    const normalizedDto = {
      ...dto,
      ...(dto.riskPreference
        ? { riskPreference: dto.riskPreference.toUpperCase() }
        : {}),
    };
    const setting = await this.repository.update(userId, normalizedDto);

    if (dto.aiDailyBudget !== undefined && !isNaN(Number(dto.aiDailyBudget))) {
      const budgetVal = Number(dto.aiDailyBudget);
      await this.prisma.aIConfiguration.upsert({
        where: { userId },
        create: { userId, dailyBudget: budgetVal },
        update: { dailyBudget: budgetVal },
      }).catch(() => null);

      await this.prisma.aIConfiguration.upsert({
        where: { userId: "system" },
        create: { userId: "system", dailyBudget: budgetVal },
        update: { dailyBudget: budgetVal },
      }).catch(() => null);
    }

    await this.audit.record("SETTINGS_UPDATE", userId, context, {
      fields: Object.keys(dto),
    });
    return this.view(setting);
  }

  private view(setting: UserSetting) {
    return {
      theme: setting.theme,
      timezone: setting.timezone,
      preferredExchange: setting.preferredExchange,
      preferredSymbols: setting.preferredSymbols,
      preferredTimeframes: setting.preferredTimeframes,
      aiDailyBudget: setting.aiDailyBudget.toString(),
      defaultLeverage: setting.defaultLeverage,
      riskPreference: setting.riskPreference,
      maxRiskPerTrade: Number(setting.maxRiskPerTrade),
      updatedAt: setting.updatedAt,
    };
  }
}
