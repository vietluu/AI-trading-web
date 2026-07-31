import { describe, expect, it, vi } from "vitest";

import { ExchangeConnectionRepository } from "../src/exchange/application/exchange-connection.repository";
import type { PrismaService } from "../src/database/prisma.service";

describe("ExchangeConnectionRepository ownership", () => {
  it("includes userId when loading a connection", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new ExchangeConnectionRepository({
      exchangeConnection: { findFirst },
    } as unknown as PrismaService);
    await repository.findOwned("connection-id", "current-user");
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "connection-id", userId: "current-user" },
      include: { credential: true },
    });
  });

  it("does not delete anything when the user does not own the ID", async () => {
    const deleteMany = vi.fn();
    const transaction = {
      exchangeConnection: {
        findFirst: vi.fn().mockResolvedValue(null),
        deleteMany,
      },
      encryptedCredential: { deleteMany: vi.fn() },
    };
    const repository = new ExchangeConnectionRepository({
      $transaction: vi.fn(
        (callback: (value: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService);
    await expect(
      repository.deleteOwned("foreign-id", "current-user"),
    ).resolves.toBe(false);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("scopes both connection and credential deletion to the owner", async () => {
    const connectionDelete = vi.fn().mockResolvedValue({ count: 1 });
    const credentialDelete = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      exchangeConnection: {
        findFirst: vi.fn().mockResolvedValue({ credentialId: "credential-id" }),
        deleteMany: connectionDelete,
      },
      encryptedCredential: { deleteMany: credentialDelete },
    };
    const repository = new ExchangeConnectionRepository({
      $transaction: vi.fn(
        (callback: (value: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService);
    await expect(
      repository.deleteOwned("connection-id", "current-user"),
    ).resolves.toBe(true);
    expect(connectionDelete).toHaveBeenCalledWith({
      where: { id: "connection-id", userId: "current-user" },
    });
    expect(credentialDelete).toHaveBeenCalledWith({
      where: { id: "credential-id", userId: "current-user" },
    });
  });
});
