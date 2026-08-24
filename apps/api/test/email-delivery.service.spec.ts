import { ConfigService } from "@nestjs/config";
import { ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmailDeliveryService } from "../src/auth/email-delivery.service";

const sendMail = vi.hoisted(() =>
  vi.fn<
    (message: { to: string; subject: string; text: string }) => Promise<{
      messageId: string;
    }>
  >(),
);

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail })),
  },
}));

describe("EmailDeliveryService", () => {
  beforeEach(() => sendMail.mockReset());

  it("sends a single-use reset link through SMTP", async () => {
    sendMail.mockResolvedValue({ messageId: "mail-1" });
    const service = new EmailDeliveryService(
      new ConfigService({
        NODE_ENV: "production",
        WEB_APP_URL: "https://trade.example.com/",
        AUTH_EMAIL_SMTP_HOST: "smtp.example.com",
        AUTH_EMAIL_SMTP_PORT: 587,
        AUTH_EMAIL_SMTP_SECURE: false,
        AUTH_EMAIL_SMTP_USER: "mailer",
        AUTH_EMAIL_SMTP_PASSWORD: "secret",
        AUTH_EMAIL_FROM: "AI Trading <no-reply@example.com>",
      }),
    );

    await service.send("RESET_PASSWORD", "user@example.com", "token/value");

    const message = sendMail.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      to: "user@example.com",
      subject: "Reset your AI Trading password",
    });
    expect(message?.text).toContain(
      "https://trade.example.com/reset-password?token=token%2Fvalue",
    );
  });

  it("fails closed in production when no transport exists", async () => {
    const service = new EmailDeliveryService(
      new ConfigService({
        NODE_ENV: "production",
        WEB_APP_URL: "https://trade.example.com",
      }),
    );

    await expect(
      service.send("RESET_PASSWORD", "user@example.com", "token"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
