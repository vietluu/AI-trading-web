import { createHmac } from "node:crypto";

import { Injectable } from "@nestjs/common";

@Injectable()
export class BinanceSignatureService {
  query(parameters: Record<string, string | number | boolean | undefined>): string {
    const query = new URLSearchParams();
    for (const key of Object.keys(parameters).sort()) {
      const value = parameters[key];
      if (value !== undefined) query.set(key, String(value));
    }
    return query.toString();
  }

  sign(query: string, secret: string): string {
    return createHmac("sha256", secret).update(query).digest("hex");
  }
}
