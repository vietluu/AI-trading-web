import { Injectable } from "@nestjs/common";
import type { User } from "@prisma/client";

import { PrismaService } from "../database/prisma.service";

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByIdentifier(identifier: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { username: identifier }],
      },
    });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(
    email: string,
    username: string,
    passwordHash: string,
    emailVerifiedAt: Date | null,
  ): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: email.toLowerCase(),
        username,
        passwordHash,
        emailVerifiedAt,
        setting: { create: {} },
      },
    });
  }

  recordFailedLogin(user: User): Promise<User> {
    const failures = user.failedLogins + 1;
    return this.prisma.user.update({
      where: { id: user.id },
      data:
        failures >= 5
          ? {
              failedLogins: 0,
              lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
            }
          : { failedLogins: failures },
    });
  }

  clearFailedLogins(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { failedLogins: 0, lockedUntil: null },
    });
  }

  updatePassword(id: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash, failedLogins: 0, lockedUntil: null },
    });
  }

  markEmailVerified(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { emailVerifiedAt: new Date() },
    });
  }

  enableTotp(id: string, totpSecret: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { totpSecret, totpEnabledAt: new Date() },
    });
  }

  disableTotp(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { totpSecret: null, totpEnabledAt: null },
    });
  }
}
