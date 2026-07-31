import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import type { RequestMetadata } from "../common/request-context";
import { AuditRepository } from "./audit.repository";

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async record(
    action: string,
    userId: string | null,
    context: RequestMetadata,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.repository.create(action, userId, context, metadata);
  }

  async hasConnectionEvent(
    action: string,
    userId: string,
    connectionId: string,
  ): Promise<boolean> {
    return this.repository.hasConnectionEvent(action, userId, connectionId);
  }
}
