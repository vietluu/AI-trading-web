import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type CredentialProvider,
  type ExchangeEnvironment,
  type ExchangeProvider,
} from "@prisma/client";

import { PrismaService } from "../../database/prisma.service";

export type ConnectionWithCredential = Prisma.ExchangeConnectionGetPayload<{
  include: { credential: true };
}>;

interface CredentialWrite {
  provider: CredentialProvider;
  label?: string;
  encryptedData: string;
  lastFour: string;
}

@Injectable()
export class ExchangeConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<ConnectionWithCredential[]> {
    return this.prisma.exchangeConnection.findMany({
      where: { userId },
      include: { credential: true },
      orderBy: { createdAt: "desc" },
    });
  }

  findOwned(
    id: string,
    userId: string,
  ): Promise<ConnectionWithCredential | null> {
    return this.prisma.exchangeConnection.findFirst({
      where: { id, userId },
      include: { credential: true },
    });
  }

  createAtomic(data: {
    userId: string;
    provider: ExchangeProvider;
    environment: ExchangeEnvironment;
    displayName?: string;
    credential: CredentialWrite;
  }): Promise<ConnectionWithCredential> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.exchangeConnection.updateMany({
        where: { userId: data.userId },
        data: { isEnabled: false },
      });
      const credential = await transaction.encryptedCredential.create({
        data: { userId: data.userId, ...data.credential },
      });
      return transaction.exchangeConnection.create({
        data: {
          userId: data.userId,
          provider: data.provider,
          environment: data.environment,
          credentialId: credential.id,
          isEnabled: true,
          ...(data.displayName ? { displayName: data.displayName } : {}),
        },
        include: { credential: true },
      });
    });
  }

  async updateOwnedAtomic(
    id: string,
    userId: string,
    connectionData: Prisma.ExchangeConnectionUpdateManyMutationInput,
    credentialData?: Pick<CredentialWrite, "encryptedData" | "lastFour">,
  ): Promise<ConnectionWithCredential | null> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.exchangeConnection.findFirst({
        where: { id, userId },
      });
      if (!existing) return null;
      if (connectionData.isEnabled === true) {
        await transaction.exchangeConnection.updateMany({
          where: { userId, NOT: { id } },
          data: { isEnabled: false },
        });
      }
      if (credentialData) {
        await transaction.encryptedCredential.updateMany({
          where: { id: existing.credentialId, userId },
          data: {
            ...credentialData,
            status: "NOT_VERIFIED",
            lastVerified: null,
          },
        });
      }
      await transaction.exchangeConnection.updateMany({
        where: { id, userId },
        data: connectionData,
      });
      return transaction.exchangeConnection.findFirst({
        where: { id, userId },
        include: { credential: true },
      });
    });
  }

  async deleteOwned(id: string, userId: string): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.exchangeConnection.findFirst({
        where: { id, userId },
      });
      if (!existing) return false;
      await transaction.exchangeConnection.deleteMany({
        where: { id, userId },
      });
      await transaction.encryptedCredential.deleteMany({
        where: { id: existing.credentialId, userId },
      });
      if (existing.isEnabled) {
        const remaining = await transaction.exchangeConnection.findFirst({
          where: { userId },
          orderBy: { createdAt: "desc" },
        });
        if (remaining) {
          await transaction.exchangeConnection.update({
            where: { id: remaining.id },
            data: { isEnabled: true },
          });
        }
      }
      return true;
    });
  }

  updateTestResult(
    id: string,
    userId: string,
    result: {
      success: boolean;
      permissions?: Prisma.InputJsonValue;
      errorCode?: string;
      occurredAt: Date;
    },
  ): Promise<ConnectionWithCredential | null> {
    return this.updateOwnedAtomic(id, userId, {
      isVerified: result.success,
      verifiedAt: result.success ? result.occurredAt : null,
      permissions: result.permissions ?? Prisma.JsonNull,
      lastErrorCode: result.errorCode ?? null,
      lastErrorAt: result.success ? null : result.occurredAt,
    });
  }
}
