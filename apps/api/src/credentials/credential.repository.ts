import { Injectable } from "@nestjs/common";
import type { CredentialProvider, EncryptedCredential } from "@prisma/client";

import { PrismaService } from "../database/prisma.service";

@Injectable()
export class CredentialRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<EncryptedCredential[]> {
    return this.prisma.encryptedCredential.findMany({
      where: { userId },
      orderBy: { provider: "asc" },
    });
  }

  findOwned(id: string, userId: string): Promise<EncryptedCredential | null> {
    return this.prisma.encryptedCredential.findFirst({ where: { id, userId } });
  }

  create(data: {
    userId: string;
    provider: CredentialProvider;
    label?: string;
    encryptedData: string;
    lastFour: string;
  }): Promise<EncryptedCredential> {
    return this.prisma.encryptedCredential.create({ data });
  }

  update(
    id: string,
    data: {
      label?: string;
      encryptedData: string;
      lastFour: string;
      status: string;
      lastVerified: null;
    },
  ): Promise<EncryptedCredential> {
    return this.prisma.encryptedCredential.update({ where: { id }, data });
  }

  delete(id: string): Promise<EncryptedCredential> {
    return this.prisma.encryptedCredential.delete({ where: { id } });
  }

  markVerified(id: string, verifiedAt: Date): Promise<EncryptedCredential> {
    return this.prisma.encryptedCredential.update({
      where: { id },
      data: { status: "STORAGE_VERIFIED", lastVerified: verifiedAt },
    });
  }
}
