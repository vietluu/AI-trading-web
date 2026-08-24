import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from "nodemailer";

type AuthEmailType = "VERIFY_EMAIL" | "RESET_PASSWORD";

interface AuthEmailContent {
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);
  private readonly webhookUrl: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly webAppUrl: string;
  private readonly from: string | undefined;
  private readonly smtp: Transporter | undefined;
  private readonly production: boolean;

  constructor(config: ConfigService) {
    this.webhookUrl = config.get<string>("AUTH_EMAIL_WEBHOOK_URL");
    this.webhookSecret = config.get<string>("AUTH_EMAIL_WEBHOOK_SECRET");
    this.webAppUrl = (
      config.get<string>("WEB_APP_URL") ?? "http://localhost:3000"
    ).replace(/\/$/, "");
    this.from = config.get<string>("AUTH_EMAIL_FROM");
    this.production = config.get<string>("NODE_ENV") === "production";
    const host = config.get<string>("AUTH_EMAIL_SMTP_HOST");
    const user = config.get<string>("AUTH_EMAIL_SMTP_USER");
    const password = config.get<string>("AUTH_EMAIL_SMTP_PASSWORD");
    if (host && this.from) {
      this.smtp = nodemailer.createTransport({
        host,
        port: config.get<number>("AUTH_EMAIL_SMTP_PORT") ?? 587,
        secure: config.get<boolean>("AUTH_EMAIL_SMTP_SECURE") ?? false,
        ...(user && password ? { auth: { user, pass: password } } : {}),
        connectionTimeout: 5_000,
        greetingTimeout: 5_000,
        socketTimeout: 10_000,
      });
    }
  }

  async send(type: AuthEmailType, to: string, token: string): Promise<void> {
    const path = type === "VERIFY_EMAIL" ? "/verify-email" : "/reset-password";
    const actionUrl = `${this.webAppUrl}${path}?token=${encodeURIComponent(token)}`;
    const content = this.content(type, actionUrl);

    if (this.smtp && this.from) {
      try {
        await this.smtp.sendMail({ from: this.from, to, ...content });
        return;
      } catch (error) {
        this.logger.error({
          event: "auth_email_smtp_failed",
          type,
          message: error instanceof Error ? error.message : "SMTP delivery failed",
        });
        throw new ServiceUnavailableException("Email delivery is temporarily unavailable");
      }
    }

    if (this.webhookUrl && this.webhookSecret) {
      await this.sendWebhook(type, to, actionUrl, content);
      return;
    }

    // Never log actionUrl/token. Development can exercise the endpoint while
    // production validation requires an actual delivery transport.
    this.logger.warn({ event: "auth_email_transport_unconfigured", type });
    if (this.production) {
      throw new ServiceUnavailableException("Email delivery is not configured");
    }
  }

  private async sendWebhook(
    type: AuthEmailType,
    to: string,
    actionUrl: string,
    content: AuthEmailContent,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.webhookUrl!, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.webhookSecret!}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type, to, actionUrl, ...content }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new ServiceUnavailableException("Email delivery is temporarily unavailable");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Email delivery is temporarily unavailable");
    }
  }

  private content(type: AuthEmailType, actionUrl: string): AuthEmailContent {
    const reset = type === "RESET_PASSWORD";
    const subject = reset
      ? "Reset your AI Trading password"
      : "Verify your AI Trading email";
    const instruction = reset
      ? "Use the link below to set a new password. The link expires in 15 minutes and can be used once."
      : "Use the link below to verify your email address. The link expires in 24 hours.";
    const action = reset ? "Reset password" : "Verify email";
    return {
      subject,
      text: `${instruction}\n\n${actionUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>${instruction}</p><p><a href="${this.escapeHtml(actionUrl)}">${action}</a></p><p>If you did not request this, you can ignore this email.</p>`,
    };
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
