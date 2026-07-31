import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import type { RequestMetadata } from "../common/request-context";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    action: string,
    userId: string | null,
    context: RequestMetadata,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action,
        userId,
        ...(context.ip ? { ip: context.ip } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
        ...(metadata === undefined ? {} : { metadata }),
      },
    });
  }
}
