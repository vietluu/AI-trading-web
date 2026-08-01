export enum ExternalDataErrorCode {
  SOURCE_UNAVAILABLE = 'SOURCE_UNAVAILABLE',
  SOURCE_TIMEOUT = 'SOURCE_TIMEOUT',
  SOURCE_RATE_LIMITED = 'SOURCE_RATE_LIMITED',
  SOURCE_AUTHENTICATION_FAILED = 'SOURCE_AUTHENTICATION_FAILED',
  SOURCE_PERMISSION_DENIED = 'SOURCE_PERMISSION_DENIED',
  SOURCE_INVALID_RESPONSE = 'SOURCE_INVALID_RESPONSE',
  SOURCE_PARSE_FAILED = 'SOURCE_PARSE_FAILED',
  SOURCE_TOO_LARGE = 'SOURCE_TOO_LARGE',
  SOURCE_REDIRECT_BLOCKED = 'SOURCE_REDIRECT_BLOCKED',
  SOURCE_SSRF_BLOCKED = 'SOURCE_SSRF_BLOCKED',
  SOURCE_UNSUPPORTED = 'SOURCE_UNSUPPORTED',
  SOURCE_NOT_CONFIGURED = 'SOURCE_NOT_CONFIGURED',
  SOURCE_STALE = 'SOURCE_STALE',
  IMPORT_VALIDATION_FAILED = 'IMPORT_VALIDATION_FAILED',
  DUPLICATE_CONTENT = 'DUPLICATE_CONTENT',
  UNKNOWN_EXTERNAL_DATA_ERROR = 'UNKNOWN_EXTERNAL_DATA_ERROR',
}

export class ExternalDataError extends Error {
  readonly code: ExternalDataErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  readonly statusCode: number;
  readonly correlationId?: string;
  readonly safeMetadata?: Record<string, string>;

  constructor(params: {
    message: string;
    code: ExternalDataErrorCode;
    provider: string;
    retryable?: boolean;
    statusCode?: number;
    correlationId?: string;
    safeMetadata?: Record<string, string>;
  }) {
    super(params.message);
    this.name = 'ExternalDataError';
    this.code = params.code;
    this.provider = params.provider;
    this.retryable = params.retryable ?? false;
    this.statusCode = params.statusCode ?? 500;
    this.correlationId = params.correlationId;
    this.safeMetadata = params.safeMetadata;
  }
}
