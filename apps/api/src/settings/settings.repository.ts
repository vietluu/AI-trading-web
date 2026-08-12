import { Injectable } from "@nestjs/common";
import { Prisma, type UserSetting } from "@prisma/client";

import { PrismaService } from "../database/prisma.service";
import type { UpdateSettingsDto } from "./settings.dto";

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  getOrCreate(userId: string): Promise<UserSetting> {
    return this.prisma.userSetting.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  update(userId: string, dto: UpdateSettingsDto): Promise<UserSetting> {
    return this.prisma.userSetting.update({
      where: { userId },
      data: {
        ...(dto.theme === undefined ? {} : { theme: dto.theme }),
        ...(dto.timezone === undefined ? {} : { timezone: dto.timezone }),
        ...(dto.preferredExchange === undefined
          ? {}
          : { preferredExchange: dto.preferredExchange }),
        ...(dto.preferredSymbols === undefined
          ? {}
          : { preferredSymbols: dto.preferredSymbols }),
        ...(dto.preferredTimeframes === undefined
          ? {}
          : { preferredTimeframes: dto.preferredTimeframes }),
        ...(dto.aiDailyBudget === undefined
          ? {}
          : { aiDailyBudget: new Prisma.Decimal(dto.aiDailyBudget) }),
        ...(dto.defaultLeverage === undefined
          ? {}
          : { defaultLeverage: dto.defaultLeverage }),
        ...(dto.riskPreference === undefined
          ? {}
          : { riskPreference: dto.riskPreference }),
        ...(dto.maxRiskPerTrade === undefined
          ? {}
          : { maxRiskPerTrade: new Prisma.Decimal(dto.maxRiskPerTrade) }),
      },
    });
  }
}
