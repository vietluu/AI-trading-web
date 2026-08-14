import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CredentialProvider,
  ExchangeEnvironment as PrismaEnvironment,
  ExchangeProvider as PrismaProvider,
  Prisma,
} from "@prisma/client";

import { AuditService } from "../../audit/audit.service";
import { RecentAuthService } from "../../auth/recent-auth.service";
import type { RequestMetadata } from "../../common/request-context";
import { EncryptionService } from "../../credentials/encryption.service";
import type { ExchangeAdapter } from "../domain/exchange.adapter";
import { ExchangeError, ExchangeErrorCode } from "../domain/exchange.error";
import {
  ExchangeEnvironment,
  ExchangeProvider,
  type ExchangeAccountConfiguration,
  type ExchangeAccountSummary,
  type ExchangeBalance,
  type ExchangeConnectionTest,
  type ExchangeCredentials,
  type ExchangeOrder,
  type ExchangeInstrument,
  type ExchangePosition,
  type PlaceOrderCommand,
  type CancelOrderCommand,
  type AmendProtectiveOrderCommand,
  type CancelProtectiveOrderCommand,
} from "../domain/exchange.types";
import { ExchangeRateLimitService } from "../infrastructure/exchange-rate-limit.service";
import { normalizeSymbol } from "../infrastructure/exchange-symbol";
import { ExchangeAdapterFactory } from "./exchange-adapter.factory";
import type {
  CreateExchangeConnectionDto,
  UpdateExchangeConnectionDto,
} from "./exchange-connection.dto";
import {
  ExchangeConnectionRepository,
  type ConnectionWithCredential,
} from "./exchange-connection.repository";

export interface ExchangeConnectionView {
  id: string;
  provider: ExchangeProvider;
  environment: ExchangeEnvironment;
  displayName: string | null;
  isEnabled: boolean;
  isVerified: boolean;
  verifiedAt: Date | null;
  permissions: unknown;
  maskedApiKey: string;
  secretConfigured: true;
  passphraseConfigured: boolean;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ExchangeConnectionService {
  private readonly productionEnabled: boolean;
  private readonly okxDemoEnabled: boolean;
  private readonly requireRecentAuth: boolean;

  constructor(
    private readonly repository: ExchangeConnectionRepository,
    private readonly encryption: EncryptionService,
    private readonly factory: ExchangeAdapterFactory,
    private readonly rateLimit: ExchangeRateLimitService,
    private readonly recentAuth: RecentAuthService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.productionEnabled =
      config.get<boolean>("EXCHANGE_PRODUCTION_CONNECTIONS_ENABLED") ?? false;
    this.okxDemoEnabled =
      config.get<boolean>("OKX_DEMO_TRADING_ENABLED") ?? true;
    this.requireRecentAuth =
      config.get<boolean>("EXCHANGE_REQUIRE_RECENT_AUTH") ?? true;
  }

  async list(userId: string): Promise<ExchangeConnectionView[]> {
    return (await this.repository.list(userId)).map((connection) =>
      this.view(connection),
    );
  }

  async get(userId: string, id: string): Promise<ExchangeConnectionView> {
    return this.view(await this.owned(id, userId));
  }

  async create(
    userId: string,
    sessionRecordId: string,
    dto: CreateExchangeConnectionDto,
    context: RequestMetadata,
  ): Promise<
    | ExchangeConnectionView
    | (ExchangeConnectionView & { test: ExchangeConnectionTest })
  > {
    this.validateEnvironment(dto.provider, dto.environment);
    this.validateCredentials(
      dto.provider,
      dto.apiKey,
      dto.apiSecret,
      dto.passphrase,
    );
    if (dto.environment === ExchangeEnvironment.PRODUCTION) {
      this.assertProductionEnabled();
      await this.assertRecent(userId, sessionRecordId);
    }
    const credentialProvider = this.credentialProvider(dto.provider);
    try {
      const connection = await this.repository.createAtomic({
        userId,
        provider: dto.provider,
        environment: dto.environment,
        ...(dto.displayName ? { displayName: dto.displayName } : {}),
        credential: {
          provider: credentialProvider,
          label: `exchange:${dto.environment}`,
          encryptedData: this.encryption.encrypt(
            {
              apiKey: dto.apiKey,
              secret: dto.apiSecret,
              ...(dto.passphrase ? { passphrase: dto.passphrase } : {}),
            },
            this.additionalData(userId, credentialProvider),
          ),
          lastFour: dto.apiKey.slice(-4),
        },
      });
      await this.audit.record("EXCHANGE_CONNECTION_CREATE", userId, context, {
        connectionId: connection.id,
        provider: dto.provider,
        environment: dto.environment,
      });
      const view = this.view(connection);
      if (!dto.testConnection) return view;
      return { ...view, test: await this.test(userId, connection.id, context) };
    } catch (caught) {
      if (
        caught instanceof Prisma.PrismaClientKnownRequestError &&
        caught.code === "P2002"
      ) {
        throw new ConflictException(
          "A connection already exists for this provider and environment",
        );
      }
      throw caught;
    }
  }

  async update(
    userId: string,
    sessionRecordId: string,
    id: string,
    dto: UpdateExchangeConnectionDto,
    context: RequestMetadata,
  ): Promise<ExchangeConnectionView> {
    const existing = await this.owned(id, userId);
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        "At least one connection field is required",
      );
    }
    const provider = this.provider(existing.provider);
    const environment =
      dto.environment ?? this.environment(existing.environment);
    this.validateEnvironment(provider, environment);
    if (
      environment === ExchangeEnvironment.PRODUCTION &&
      (existing.environment !== PrismaEnvironment.PRODUCTION ||
        dto.isEnabled === true)
    ) {
      this.assertProductionEnabled();
      await this.assertRecent(userId, sessionRecordId);
    }
    const credentialChange =
      dto.apiKey !== undefined ||
      dto.apiSecret !== undefined ||
      dto.passphrase !== undefined;
    let encrypted: { encryptedData: string; lastFour: string } | undefined;
    if (credentialChange) {
      await this.assertRecent(userId, sessionRecordId);
      if (!dto.apiKey || !dto.apiSecret) {
        throw new BadRequestException(
          "API key and API secret are both required when replacing credentials",
        );
      }
      this.validateCredentials(
        provider,
        dto.apiKey,
        dto.apiSecret,
        dto.passphrase,
      );
      const credentialProvider = this.credentialProvider(provider);
      encrypted = {
        encryptedData: this.encryption.encrypt(
          {
            apiKey: dto.apiKey,
            secret: dto.apiSecret,
            ...(dto.passphrase ? { passphrase: dto.passphrase } : {}),
          },
          this.additionalData(userId, credentialProvider),
        ),
        lastFour: dto.apiKey.slice(-4),
      };
    }
    let updated: ConnectionWithCredential | null;
    try {
      updated = await this.repository.updateOwnedAtomic(
        id,
        userId,
        {
          ...(dto.displayName !== undefined
            ? { displayName: dto.displayName || null }
            : {}),
          ...(dto.environment ? { environment: dto.environment } : {}),
          ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
          ...(credentialChange || dto.environment
            ? {
                isVerified: false,
                verifiedAt: null,
                permissions: Prisma.JsonNull,
              }
            : {}),
        },
        encrypted,
      );
    } catch (caught) {
      if (
        caught instanceof Prisma.PrismaClientKnownRequestError &&
        caught.code === "P2002"
      ) {
        throw new ConflictException(
          "A connection already exists for this provider and environment",
        );
      }
      throw caught;
    }
    if (!updated) throw new NotFoundException("Exchange connection not found");
    await this.audit.record("EXCHANGE_CONNECTION_UPDATE", userId, context, {
      connectionId: id,
      provider,
      environment,
      credentialsReplaced: credentialChange,
    });
    return this.view(updated);
  }

  async delete(
    userId: string,
    sessionRecordId: string,
    id: string,
    context: RequestMetadata,
  ): Promise<void> {
    const existing = await this.repository.findOwned(id, userId);
    if (!existing) {
      const wasDeleted = await this.audit.hasConnectionEvent(
        "EXCHANGE_CONNECTION_DELETE",
        userId,
        id,
      );
      if (wasDeleted) return;
      throw new NotFoundException("Exchange connection not found");
    }
    await this.assertRecent(userId, sessionRecordId);
    if (!(await this.repository.deleteOwned(id, userId))) return;
    await this.audit.record("EXCHANGE_CONNECTION_DELETE", userId, context, {
      connectionId: id,
    });
  }

  async setEnabled(
    userId: string,
    sessionRecordId: string,
    id: string,
    enabled: boolean,
    context: RequestMetadata,
  ): Promise<ExchangeConnectionView> {
    const existing = await this.owned(id, userId);
    if (enabled) {
      if (existing.environment === PrismaEnvironment.PRODUCTION) {
        this.assertProductionEnabled();
        await this.assertRecent(userId, sessionRecordId);
      }
      const testResult = await this.test(userId, id, context);
      if (!testResult.success) {
        await this.repository.updateOwnedAtomic(id, userId, {
          isEnabled: false,
          isVerified: false,
          verifiedAt: null,
          lastErrorCode: testResult.errorCode ?? "ACTIVATION_TEST_FAILED",
          lastErrorAt: new Date(),
        });
        throw new BadRequestException(
          `Cannot set '${existing.displayName ?? existing.provider}' as active: exchange connection test failed (${testResult.message ?? testResult.errorCode}). Please check API credentials and permissions.`,
        );
      }
    }
    const updated = await this.repository.updateOwnedAtomic(id, userId, {
      isEnabled: enabled,
      ...(enabled ? { isVerified: true, verifiedAt: new Date() } : {}),
    });
    if (!updated) throw new NotFoundException("Exchange connection not found");
    await this.audit.record(
      enabled ? "EXCHANGE_CONNECTION_ENABLE" : "EXCHANGE_CONNECTION_DISABLE",
      userId,
      context,
      { connectionId: id, provider: existing.provider },
    );
    return this.view(updated);
  }

  async test(
    userId: string,
    id: string,
    context: RequestMetadata,
  ): Promise<ExchangeConnectionTest> {
    const existing = await this.owned(id, userId);
    const provider = this.provider(existing.provider);
    const environment = this.environment(existing.environment);
    await this.rateLimit.private(provider, environment, userId, id);
    let result: ExchangeConnectionTest;
    try {
      result = await this.factory
        .get(provider)
        .testPrivateConnection(this.credentials(existing));
    } catch (caught) {
      result = {
        success: false,
        provider,
        environment,
        ...(caught instanceof ExchangeError
          ? { errorCode: caught.code, message: caught.message }
          : {
              errorCode: "EXCHANGE_UNKNOWN_ERROR",
              message: "Connection test failed",
            }),
      };
    }
    const permissions = result.permissions
      ? (result.permissions as unknown as Prisma.InputJsonValue)
      : undefined;
    await this.repository.updateTestResult(id, userId, {
      success: result.success,
      ...(permissions ? { permissions } : {}),
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      occurredAt: new Date(),
    });
    await this.audit.record("EXCHANGE_CONNECTION_TEST", userId, context, {
      connectionId: id,
      provider,
      environment,
      success: result.success,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    });
    return result;
  }

  account(
    userId: string,
    id: string,
    context: RequestMetadata,
  ): Promise<ExchangeAccountSummary> {
    return this.privateCall(
      userId,
      id,
      "ACCOUNT",
      context,
      (adapter, credentials) => adapter.getAccountSummary(credentials),
    );
  }

  balances(
    userId: string,
    id: string,
    context: RequestMetadata,
  ): Promise<ExchangeBalance[]> {
    return this.privateCall(
      userId,
      id,
      "BALANCES",
      context,
      (adapter, credentials) => adapter.getBalances(credentials),
    );
  }

  positions(
    userId: string,
    id: string,
    context: RequestMetadata,
  ): Promise<ExchangePosition[]> {
    return this.privateCall(
      userId,
      id,
      "POSITIONS",
      context,
      (adapter, credentials) => adapter.getPositions(credentials),
    );
  }

  openOrders(
    userId: string,
    id: string,
    context: RequestMetadata,
    symbol?: string,
  ): Promise<ExchangeOrder[]> {
    return this.privateCall(
      userId,
      id,
      "OPEN_ORDERS",
      context,
      (adapter, credentials) =>
        adapter.getOpenOrders(
          credentials,
          symbol ? { symbol: normalizeSymbol(symbol) } : undefined,
        ),
    );
  }

  orderHistory(
    userId: string,
    id: string,
    context: RequestMetadata,
    symbols?: string[],
    limit?: number,
  ): Promise<ExchangeOrder[]> {
    return this.privateCall(
      userId,
      id,
      "ORDER_HISTORY",
      context,
      (adapter, credentials) =>
        adapter.getOrderHistory?.(credentials, symbols, limit) ??
        Promise.resolve([]),
    );
  }

  tradeFills(
    userId: string,
    id: string,
    context: RequestMetadata,
    symbols?: string[],
    limit?: number,
    before?: Date,
  ) {
    return this.privateCall(
      userId,
      id,
      "TRADE_FILLS",
      context,
      (adapter, credentials) =>
        adapter.getTradeFills?.(credentials, symbols, limit, before) ??
        Promise.resolve([]),
    );
  }

  order(
    userId: string,
    id: string,
    orderId: string,
    symbol: string,
    context: RequestMetadata,
  ): Promise<ExchangeOrder> {
    return this.privateCall(
      userId,
      id,
      "ORDER_LOOKUP",
      context,
      (adapter, credentials) =>
        adapter.getOrder(credentials, {
          orderId,
          symbol: normalizeSymbol(symbol),
        }),
    );
  }

  configuration(
    userId: string,
    id: string,
    context: RequestMetadata,
  ): Promise<ExchangeAccountConfiguration> {
    return this.privateCall(
      userId,
      id,
      "CONFIGURATION",
      context,
      (adapter, credentials) => adapter.getAccountConfiguration(credentials),
    );
  }

  instrument(
    userId: string,
    id: string,
    symbol: string,
    context: RequestMetadata,
  ): Promise<ExchangeInstrument> {
    const normalized = normalizeSymbol(symbol);
    return this.privateCall(
      userId,
      id,
      "INSTRUMENT_CHECK",
      context,
      async (adapter, credentials) => {
        const instrument = (
          await adapter.getInstruments({
            symbol: normalized,
            environment: credentials.environment,
          })
        ).find(
          (candidate) =>
            candidate.symbol === normalized && candidate.status === "TRADING",
        );
        if (!instrument) {
          throw new ExchangeError(
            ExchangeErrorCode.INVALID_SYMBOL,
            adapter.provider,
            false,
            400,
            `Exchange symbol ${normalized} is unavailable in ${credentials.environment}`,
          );
        }
        return instrument;
      },
    );
  }

  placeOrder(
    userId: string,
    id: string,
    command: PlaceOrderCommand,
    context: RequestMetadata,
  ): Promise<ExchangeOrder> {
    return this.privateCall(
      userId,
      id,
      "PLACE_ORDER",
      context,
      (adapter, credentials) => adapter.placeOrder(credentials, command),
    );
  }

  cancelOrder(
    userId: string,
    id: string,
    command: CancelOrderCommand,
    context: RequestMetadata,
  ): Promise<ExchangeOrder> {
    return this.privateCall(
      userId,
      id,
      "CANCEL_ORDER",
      context,
      (adapter, credentials) => adapter.cancelOrder(credentials, command),
    );
  }

  amendProtectiveOrder(
    userId: string,
    id: string,
    command: AmendProtectiveOrderCommand,
    context: RequestMetadata,
  ): Promise<void> {
    return this.privateCall(
      userId,
      id,
      "AMEND_PROTECTIVE_ORDER",
      context,
      (adapter, credentials) => {
        if (!adapter.amendProtectiveOrder) {
          throw new Error("PROTECTIVE_ORDER_AMEND_UNSUPPORTED");
        }
        return adapter.amendProtectiveOrder(credentials, command);
      },
    );
  }

  cancelProtectiveOrder(
    userId: string,
    id: string,
    command: CancelProtectiveOrderCommand,
    context: RequestMetadata,
  ): Promise<void> {
    return this.privateCall(
      userId,
      id,
      "CANCEL_PROTECTIVE_ORDER",
      context,
      (adapter, credentials) => {
        if (!adapter.cancelProtectiveOrder) {
          throw new Error("PROTECTIVE_ORDER_CANCEL_UNSUPPORTED");
        }
        return adapter.cancelProtectiveOrder(credentials, command);
      },
    );
  }

  private async privateCall<T>(
    userId: string,
    id: string,
    action: string,
    context: RequestMetadata,
    operation: (
      adapter: ExchangeAdapter,
      credentials: ExchangeCredentials,
    ) => Promise<T>,
  ): Promise<T> {
    let connection: ConnectionWithCredential;
    try {
      connection = await this.owned(id, userId);
    } catch (caught) {
      await this.audit.record("EXCHANGE_PRIVATE_ACCESS", userId, context, {
        connectionId: id,
        operation: action,
        status: "FAILED",
        errorCode: "CONNECTION_NOT_FOUND",
      });
      throw caught;
    }
    if (!connection.isEnabled) {
      await this.audit.record("EXCHANGE_PRIVATE_ACCESS", userId, context, {
        connectionId: id,
        provider: connection.provider,
        operation: action,
        status: "FAILED",
        errorCode: "CONNECTION_DISABLED",
      });
      throw new ForbiddenException("Exchange connection is disabled");
    }
    if (!connection.isVerified) {
      await this.audit.record("EXCHANGE_PRIVATE_ACCESS", userId, context, {
        connectionId: id,
        provider: connection.provider,
        operation: action,
        status: "FAILED",
        errorCode: "CONNECTION_NOT_VERIFIED",
      });
      throw new ForbiddenException(
        "Test the exchange connection before accessing private data",
      );
    }
    const provider = this.provider(connection.provider);
    const environment = this.environment(connection.environment);
    await this.rateLimit.private(provider, environment, userId, id);
    try {
      const result = await operation(
        this.factory.get(provider),
        this.credentials(connection),
      );
      await this.audit.record("EXCHANGE_PRIVATE_ACCESS", userId, context, {
        connectionId: id,
        provider,
        operation: action,
        status: "SUCCESS",
      });
      return result;
    } catch (caught) {
      await this.audit.record("EXCHANGE_PRIVATE_ACCESS", userId, context, {
        connectionId: id,
        provider,
        operation: action,
        status: "FAILED",
        ...(caught instanceof ExchangeError ? { errorCode: caught.code } : {}),
      });
      throw caught;
    }
  }

  private async owned(
    id: string,
    userId: string,
  ): Promise<ConnectionWithCredential> {
    const connection = await this.repository.findOwned(id, userId);
    if (!connection)
      throw new NotFoundException("Exchange connection not found");
    return connection;
  }

  private credentials(
    connection: ConnectionWithCredential,
  ): ExchangeCredentials {
    const provider = this.provider(connection.provider);
    const credentialProvider = this.credentialProvider(provider);
    const secret = this.encryption.decrypt(
      connection.credential.encryptedData,
      this.additionalData(connection.userId, credentialProvider),
    );
    if (!secret.secret)
      throw new BadRequestException("Stored exchange credential is incomplete");
    return {
      apiKey: secret.apiKey,
      apiSecret: secret.secret,
      ...(secret.passphrase ? { passphrase: secret.passphrase } : {}),
      environment: this.environment(connection.environment),
    };
  }

  private validateEnvironment(
    provider: ExchangeProvider,
    environment: ExchangeEnvironment,
  ): void {
    const valid =
      provider === ExchangeProvider.BINANCE_FUTURES
        ? [ExchangeEnvironment.TESTNET, ExchangeEnvironment.PRODUCTION]
        : [ExchangeEnvironment.DEMO, ExchangeEnvironment.PRODUCTION];
    if (!valid.includes(environment)) {
      throw new BadRequestException(
        `${environment} is not supported by ${provider}`,
      );
    }
    if (
      provider === ExchangeProvider.OKX_FUTURES &&
      environment === ExchangeEnvironment.DEMO &&
      !this.okxDemoEnabled
    ) {
      throw new ForbiddenException("OKX demo trading connections are disabled");
    }
  }

  private validateCredentials(
    provider: ExchangeProvider,
    apiKey: string,
    apiSecret: string,
    passphrase?: string,
  ): void {
    if (!apiKey.trim() || !apiSecret.trim()) {
      throw new BadRequestException("API key and API secret are required");
    }
    if (provider === ExchangeProvider.OKX_FUTURES && !passphrase?.trim()) {
      throw new BadRequestException("OKX passphrase is required");
    }
  }

  private assertProductionEnabled(): void {
    if (!this.productionEnabled) {
      throw new ForbiddenException(
        "Production exchange connections are disabled",
      );
    }
  }

  private assertRecent(userId: string, sessionRecordId: string): Promise<void> {
    return this.requireRecentAuth
      ? this.recentAuth.assertRecent(userId, sessionRecordId)
      : Promise.resolve();
  }

  private provider(value: PrismaProvider): ExchangeProvider {
    return value as unknown as ExchangeProvider;
  }

  private environment(value: PrismaEnvironment): ExchangeEnvironment {
    return value as unknown as ExchangeEnvironment;
  }

  private credentialProvider(provider: ExchangeProvider): CredentialProvider {
    return provider === ExchangeProvider.BINANCE_FUTURES
      ? CredentialProvider.BINANCE_FUTURES
      : CredentialProvider.OKX_FUTURES;
  }

  private additionalData(userId: string, provider: CredentialProvider): string {
    return `${userId}:${provider}`;
  }

  private view(connection: ConnectionWithCredential): ExchangeConnectionView {
    return {
      id: connection.id,
      provider: this.provider(connection.provider),
      environment: this.environment(connection.environment),
      displayName: connection.displayName,
      isEnabled: connection.isEnabled,
      isVerified: connection.isVerified,
      verifiedAt: connection.verifiedAt,
      permissions: connection.permissions,
      maskedApiKey: `****${connection.credential.lastFour}`,
      secretConfigured: true,
      passphraseConfigured: connection.provider === PrismaProvider.OKX_FUTURES,
      lastErrorCode: connection.lastErrorCode,
      lastErrorAt: connection.lastErrorAt,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }
}
