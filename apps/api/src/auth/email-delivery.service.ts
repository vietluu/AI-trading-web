import { ServiceUnavailableException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type AuthEmailType = "VERIFY_EMAIL" | "RESET_PASSWORD";

@Injectable()
export class EmailDeliveryService {
  private readonly webhookUrl: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly webAppUrl: string;

  constructor(config: ConfigService) {
    this.webhookUrl = config.get<string>("AUTH_EMAIL_WEBHOOK_URL");
    this.webhookSecret = config.get<string>("AUTH_EMAIL_WEBHOOK_SECRET");
    this.webAppUrl =
      config.get<string>("WEB_APP_URL") ?? "http://localhost:3000";
  }

  async send(type: AuthEmailType, to: string, token: string): Promise<void> {
    if (!this.webhookUrl || !this.webhookSecret) {
      if (type === "VERIFY_EMAIL") {
        throw new ServiceUnavailableException(
          "Email delivery is not configured",
        );
      }
      return;
    }
    const path = type === "VERIFY_EMAIL" ? "/verify-email" : "/reset-password";
    let response: Response;
    try {
      response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.webhookSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type,
          to,
          actionUrl: `${this.webAppUrl}${path}?token=${encodeURIComponent(token)}`,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Email delivery is temporarily unavailable",
      );
    }
    if (!response.ok)
      throw new ServiceUnavailableException(
        "Email delivery is temporarily unavailable",
      );
  }
}
