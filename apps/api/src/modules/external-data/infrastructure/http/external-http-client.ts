import { Injectable, Logger } from '@nestjs/common';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import {
  ExternalDataError,
  ExternalDataErrorCode,
} from '../../domain/errors/external-data.error';

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
}

export interface HttpRequestOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  etag?: string;
  lastModified?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

@Injectable()
export class ExternalHttpClient {
  private readonly logger = new Logger(ExternalHttpClient.name);

  private readonly defaultTimeoutMs = 10000;
  private readonly defaultMaxBytes = 5 * 1024 * 1024; // 5 MB
  private readonly defaultMaxRedirects = 3;
  private readonly userAgent = 'CryptoResearchPlatform-ExternalDataIngestion/1.0';

  async fetch(options: HttpRequestOptions): Promise<HttpResponse> {
    return this.executeFetch(options, 0);
  }

  private async executeFetch(
    options: HttpRequestOptions,
    redirectCount: number,
  ): Promise<HttpResponse> {
    const {
      url: targetUrl,
      method = 'GET',
      headers = {},
      etag,
      lastModified,
      timeoutMs = this.defaultTimeoutMs,
      maxResponseBytes = this.defaultMaxBytes,
      maxRedirects = this.defaultMaxRedirects,
    } = options;

    if (redirectCount > maxRedirects) {
      throw new ExternalDataError({
        message: `Too many redirects (limit: ${maxRedirects}) for URL: ${targetUrl}`,
        code: ExternalDataErrorCode.SOURCE_REDIRECT_BLOCKED,
        provider: 'ExternalHttpClient',
        retryable: false,
        statusCode: 400,
      });
    }

    // 1. Validate & Parse URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      throw new ExternalDataError({
        message: `Malformed URL scheme or target: ${targetUrl}`,
        code: ExternalDataErrorCode.SOURCE_SSRF_BLOCKED,
        provider: 'ExternalHttpClient',
        retryable: false,
        statusCode: 400,
      });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new ExternalDataError({
        message: `Unsupported protocol scheme: ${parsedUrl.protocol}`,
        code: ExternalDataErrorCode.SOURCE_SSRF_BLOCKED,
        provider: 'ExternalHttpClient',
        retryable: false,
        statusCode: 400,
      });
    }

    // 2. SSRF Check: IP & Hostname Validation
    await this.validateSsrfTarget(parsedUrl.hostname);

    // 3. Prepare headers
    const requestHeaders: Record<string, string> = {
      'User-Agent': this.userAgent,
      Accept: 'application/rss+xml, application/atom+xml, application/json, text/xml, text/plain, */*',
      'Accept-Encoding': 'gzip, deflate',
      ...headers,
    };

    if (etag) {
      requestHeaders['If-None-Match'] = etag;
    }
    if (lastModified) {
      requestHeaders['If-Modified-Since'] = lastModified;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const requestFn = isHttps ? https.request : http.request;

    return new Promise<HttpResponse>((resolve, reject) => {
      let reqTimeoutTimer: NodeJS.Timeout | null = null;

      const req = requestFn(
        parsedUrl,
        {
          method,
          headers: requestHeaders,
        },
        (res) => {
          if (reqTimeoutTimer) clearTimeout(reqTimeoutTimer);

          const statusCode = res.statusCode ?? 500;

          // Handle 304 Not Modified
          if (statusCode === 304) {
            return resolve({
              statusCode: 304,
              headers: res.headers,
              body: '',
              etag: (res.headers['etag'] as string) || etag,
              lastModified: (res.headers['last-modified'] as string) || lastModified,
              notModified: true,
            });
          }

          // Handle Redirects (301, 302, 307, 308)
          if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
            const redirectLocation = new URL(res.headers.location, parsedUrl.href).href;
            res.resume(); // consume stream
            return this.executeFetch(
              { ...options, url: redirectLocation },
              redirectCount + 1,
            )
              .then(resolve)
              .catch(reject);
          }

          let body = '';
          let bytesRead = 0;

          // Decompression handling
          let stream: NodeJS.ReadableStream = res;
          const encoding = res.headers['content-encoding'];
          if (encoding === 'gzip' || encoding === 'deflate') {
            const zlib = require('zlib');
            stream = stream.pipe(encoding === 'gzip' ? zlib.createGunzip() : zlib.createInflate());
          }

          stream.on('data', (chunk: Buffer | string) => {
            bytesRead += chunk.length;
            if (bytesRead > maxResponseBytes) {
              req.destroy();
              return reject(
                new ExternalDataError({
                  message: `Response size exceeded maximum allowed limit (${maxResponseBytes} bytes)`,
                  code: ExternalDataErrorCode.SOURCE_TOO_LARGE,
                  provider: 'ExternalHttpClient',
                  retryable: false,
                  statusCode: 413,
                }),
              );
            }
            body += chunk.toString('utf-8');
          });

          stream.on('end', () => {
            if (statusCode < 200 || statusCode >= 300) {
              return reject(
                new ExternalDataError({
                  message: `HTTP error ${statusCode} when fetching ${parsedUrl.hostname}`,
                  code: statusCode === 429
                    ? ExternalDataErrorCode.SOURCE_RATE_LIMITED
                    : statusCode === 401 || statusCode === 403
                    ? ExternalDataErrorCode.SOURCE_AUTHENTICATION_FAILED
                    : ExternalDataErrorCode.SOURCE_INVALID_RESPONSE,
                  provider: 'ExternalHttpClient',
                  retryable: statusCode === 429 || statusCode >= 500,
                  statusCode,
                }),
              );
            }

            resolve({
              statusCode,
              headers: res.headers,
              body,
              etag: (res.headers['etag'] as string) || undefined,
              lastModified: (res.headers['last-modified'] as string) || undefined,
              notModified: false,
            });
          });

          stream.on('error', (err) => {
            reject(
              new ExternalDataError({
                message: `Stream read error: ${err.message}`,
                code: ExternalDataErrorCode.SOURCE_PARSE_FAILED,
                provider: 'ExternalHttpClient',
                retryable: true,
                statusCode: 500,
              }),
            );
          });
        },
      );

      reqTimeoutTimer = setTimeout(() => {
        req.destroy();
        reject(
          new ExternalDataError({
            message: `HTTP request timed out after ${timeoutMs} ms for ${parsedUrl.hostname}`,
            code: ExternalDataErrorCode.SOURCE_TIMEOUT,
            provider: 'ExternalHttpClient',
            retryable: true,
            statusCode: 504,
          }),
        );
      }, timeoutMs);

      req.on('error', (err) => {
        if (reqTimeoutTimer) clearTimeout(reqTimeoutTimer);
        reject(
          new ExternalDataError({
            message: `Network request failure: ${err.message}`,
            code: ExternalDataErrorCode.SOURCE_UNAVAILABLE,
            provider: 'ExternalHttpClient',
            retryable: true,
            statusCode: 502,
          }),
        );
      });

      req.end();
    });
  }

  async validateSsrfTarget(hostname: string): Promise<void> {
    const lowerHost = hostname.toLowerCase();

    if (
      lowerHost === 'localhost' ||
      lowerHost.endsWith('.localhost') ||
      lowerHost.endsWith('.local') ||
      lowerHost.endsWith('.internal')
    ) {
      throw new ExternalDataError({
        message: `Forbidden target hostname: ${hostname}`,
        code: ExternalDataErrorCode.SOURCE_SSRF_BLOCKED,
        provider: 'ExternalHttpClient',
        retryable: false,
        statusCode: 400,
      });
    }

    try {
      const addresses = await dns.promises.lookup(hostname, { all: true });
      for (const record of addresses) {
        if (this.isPrivateOrLocalIp(record.address)) {
          throw new ExternalDataError({
            message: `Host ${hostname} resolves to blocked private/local IP ${record.address}`,
            code: ExternalDataErrorCode.SOURCE_SSRF_BLOCKED,
            provider: 'ExternalHttpClient',
            retryable: false,
            statusCode: 400,
          });
        }
      }
    } catch (err: any) {
      if (err instanceof ExternalDataError) throw err;
      throw new ExternalDataError({
        message: `DNS resolution failed for ${hostname}: ${err.message}`,
        code: ExternalDataErrorCode.SOURCE_UNAVAILABLE,
        provider: 'ExternalHttpClient',
        retryable: false,
        statusCode: 400,
      });
    }
  }

  private isPrivateOrLocalIp(ip: string): boolean {
    // IPv4 check
    if (ip.includes('.')) {
      const parts = ip.split('.').map(Number);
      if (parts.length !== 4 || parts.some(isNaN)) return true;

      const p0 = parts[0];
      const p1 = parts[1];
      if (p0 == null || p1 == null) return true;

      // 127.0.0.0/8 (Loopback)
      if (p0 === 127) return true;
      // 10.0.0.0/8 (Private)
      if (p0 === 10) return true;
      // 172.16.0.0/12 (Private)
      if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
      // 192.168.0.0/16 (Private)
      if (p0 === 192 && p1 === 168) return true;
      // 169.254.0.0/16 (Link-local / Cloud Metadata)
      if (p0 === 169 && p1 === 254) return true;
      // 0.0.0.0/8 (Current network)
      if (p0 === 0) return true;
    } else if (ip.includes(':')) {
      // IPv6 check
      const normalized = ip.toLowerCase();
      if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
      if (normalized.startsWith('fe80:')) return true; // link-local
      if (normalized.startsWith('fc00:') || normalized.startsWith('fd00:')) return true; // unique local
    }

    return false;
  }
}
