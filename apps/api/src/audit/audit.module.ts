import { Global, Module } from "@nestjs/common";

import { AuditService } from "./audit.service";
import { AuditRepository } from "./audit.repository";

@Global()
@Module({
  providers: [AuditService, AuditRepository],
  exports: [AuditService],
})
export class AuditModule {}
