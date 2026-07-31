import type { Request } from "express";

export interface AuthenticatedRequest extends Request {
  auth: {
    userId: string;
    sessionRecordId: string;
    sessionToken: string;
  };
}

export interface RequestMetadata {
  ip?: string;
  userAgent?: string;
}

export function requestMetadata(request: Request): RequestMetadata {
  const userAgent = request.get("user-agent");
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
