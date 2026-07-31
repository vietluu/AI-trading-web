import { Injectable } from "@nestjs/common";
import type { Session } from "@prisma/client";

import type { RequestMetadata } from "../common/request-context";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    userId: string,
    sessionId: string,
    expiresAt: Date,
    context: RequestMetadata,
  ): Promise<Session> {
    return this.prisma.session.create({
      data: {
        userId,
        sessionId,
        expiresAt,
        ...(context.ip ? { ip: context.ip } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      },
    });
  }

  findBySessionId(sessionId: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { sessionId } });
  }

  touch(id: string): Promise<Session> {
    return this.prisma.session.update({
      where: { id },
      data: { lastActivity: new Date() },
    });
  }

  delete(id: string): Promise<Session> {
    return this.prisma.session.delete({ where: { id } });
  }

  async deleteBySessionId(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { sessionId } });
  }

  listActive(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { lastActivity: "desc" },
    });
  }

  findOwned(id: string, userId: string): Promise<Session | null> {
    return this.prisma.session.findFirst({ where: { id, userId } });
  }

  listIdentifiers(userId: string): Promise<Array<{ sessionId: string }>> {
    return this.prisma.session.findMany({
      where: { userId },
      select: { sessionId: true },
    });
  }

  async deleteAll(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }
}
