import { createHmac } from "node:crypto";

import { Injectable } from "@nestjs/common";

@Injectable()
export class OkxSignatureService {
  sign(
    timestamp: string,
    method: string,
    requestPath: string,
    body: string,
    secret: string,
  ): string {
    return createHmac("sha256", secret)
      .update(`${timestamp}${method.toUpperCase()}${requestPath}${body}`)
      .digest("base64");
  }
}
