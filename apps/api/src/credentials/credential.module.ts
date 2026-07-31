import { Module } from "@nestjs/common";

import { CredentialController } from "./credential.controller";
import { CredentialRepository } from "./credential.repository";
import { CredentialService } from "./credential.service";
import { EncryptionService } from "./encryption.service";

@Module({
  controllers: [CredentialController],
  providers: [CredentialService, CredentialRepository, EncryptionService],
})
export class CredentialModule {}
