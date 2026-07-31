import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { EncryptedCredential } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../common/request-context";
import { CredentialRepository } from "./credential.repository";
import type {
  CreateCredentialDto,
  UpdateCredentialDto,
} from "./credential.dto";
import { EncryptionService, type CredentialSecret } from "./encryption.service";

export interface CredentialView {
  id: string;
  provider: string;
  label: string | null;
  status: string;
  maskedKey: string;
  lastVerified: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CredentialService {
  constructor(
    private readonly repository: CredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<CredentialView[]> {
    return (await this.repository.list(userId)).map((credential) =>
      this.view(credential),
    );
  }

  async create(
    userId: string,
    dto: CreateCredentialDto,
    context: RequestMetadata,
  ): Promise<CredentialView> {
    const credential = await this.repository.create({
      userId,
      provider: dto.provider,
      ...(dto.label ? { label: dto.label } : {}),
      encryptedData: this.encryption.encrypt(
        this.secret(dto.apiKey, dto.secret, dto.passphrase),
        this.additionalData(userId, dto.provider),
      ),
      lastFour: dto.apiKey.slice(-4),
    });
    await this.audit.record("CREDENTIAL_CREATE", userId, context, {
      provider: dto.provider,
      credentialId: credential.id,
    });
    return this.view(credential);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCredentialDto,
    context: RequestMetadata,
  ): Promise<CredentialView> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        "At least one credential field is required",
      );
    }
    const existing = await this.owned(id, userId);
    const additionalData = this.additionalData(userId, existing.provider);
    const current = this.encryption.decrypt(
      existing.encryptedData,
      additionalData,
    );
    const merged = this.secret(
      dto.apiKey ?? current.apiKey,
      dto.secret ?? current.secret,
      dto.passphrase ?? current.passphrase,
    );
    const label = dto.label ?? existing.label;
    const credential = await this.repository.update(id, {
      ...(label ? { label } : {}),
      encryptedData: this.encryption.encrypt(merged, additionalData),
      lastFour: merged.apiKey.slice(-4),
      status: "NOT_VERIFIED",
      lastVerified: null,
    });
    await this.audit.record("CREDENTIAL_UPDATE", userId, context, {
      provider: existing.provider,
      credentialId: id,
    });
    return this.view(credential);
  }

  async delete(
    userId: string,
    id: string,
    context: RequestMetadata,
  ): Promise<void> {
    const existing = await this.owned(id, userId);
    await this.repository.delete(id);
    await this.audit.record("CREDENTIAL_DELETE", userId, context, {
      provider: existing.provider,
      credentialId: id,
    });
  }

  async test(
    userId: string,
    id: string,
    context: RequestMetadata,
  ): Promise<CredentialView & { validationScope: "ENCRYPTED_STORAGE" }> {
    const existing = await this.owned(id, userId);
    const secret = this.encryption.decrypt(
      existing.encryptedData,
      this.additionalData(userId, existing.provider),
    );
    if (secret.apiKey.length < 4)
      throw new Error("Stored credential is invalid");
    const credential = await this.repository.markVerified(id, new Date());
    await this.audit.record("CREDENTIAL_TEST", userId, context, {
      provider: existing.provider,
      credentialId: id,
      validationScope: "ENCRYPTED_STORAGE",
    });
    return { ...this.view(credential), validationScope: "ENCRYPTED_STORAGE" };
  }

  private async owned(
    id: string,
    userId: string,
  ): Promise<EncryptedCredential> {
    const credential = await this.repository.findOwned(id, userId);
    if (!credential) throw new NotFoundException("Credential not found");
    return credential;
  }

  private secret(
    apiKey: string,
    secret?: string,
    passphrase?: string,
  ): CredentialSecret {
    return {
      apiKey,
      ...(secret ? { secret } : {}),
      ...(passphrase ? { passphrase } : {}),
    };
  }

  private additionalData(userId: string, provider: string): string {
    return `${userId}:${provider}`;
  }

  private view(credential: EncryptedCredential): CredentialView {
    return {
      id: credential.id,
      provider: credential.provider,
      label: credential.label,
      status: credential.status,
      maskedKey: `••••${credential.lastFour}`,
      lastVerified: credential.lastVerified,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }
}
