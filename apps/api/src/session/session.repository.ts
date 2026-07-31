import { Injectable } from "@nestjs/common";
import type { Session } from "@prisma/client";

import type { RequestMetadata } from "../common/request-context";
import { PrismaService } from "../database/prisma.service";

interface CreateSessionData {
  userId: string;
  sessionId: string;
  tokenFamily: string;
  generation: number;
  csrfHash: string;
  fingerprint: string;
  rememberMe: boolean;
  expiresAt: Date;
  context: RequestMetadata;
}

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateSessionData): Promise<Session> {
    return this.prisma.session.create({ data: this.record(data) });
  }

  async rotate(id: string, data: CreateSessionData): Promise<Session | null> {
    return this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.session.updateMany({
        where: { id, revokedAt: null, rotatedAt: null },
        data: { revokedAt: new Date(), rotatedAt: new Date() },
      });
      if (changed.count !== 1) return null;
      return transaction.session.create({ data: this.record(data) });
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

  revoke(id: string): Promise<Session> {
    return this.prisma.session.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeBySessionId(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  listActive(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastActivity: "desc" },
    });
  }

  findOwned(id: string, userId: string): Promise<Session | null> {
    return this.prisma.session.findFirst({ where: { id, userId } });
  }

  listIdentifiers(userId: string): Promise<Array<{ sessionId: string }>> {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      select: { sessionId: true },
    });
  }

  listFamilyIdentifiers(
    tokenFamily: string,
  ): Promise<Array<{ sessionId: string }>> {
    return this.prisma.session.findMany({
      where: { tokenFamily },
      select: { sessionId: true },
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(tokenFamily: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenFamily, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private record(data: CreateSessionData) {
    return {
      userId: data.userId,
      sessionId: data.sessionId,
      tokenFamily: data.tokenFamily,
      generation: data.generation,
      csrfHash: data.csrfHash,
      fingerprint: data.fingerprint,
      rememberMe: data.rememberMe,
      expiresAt: data.expiresAt,
      ...(data.context.ip ? { ip: data.context.ip } : {}),
      ...(data.context.userAgent ? { userAgent: data.context.userAgent } : {}),
    };
  }
}
