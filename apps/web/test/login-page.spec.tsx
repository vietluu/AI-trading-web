import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "@/app/login/page";
import { checkCurrentUser } from "@/services/auth.service";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace }),
}));

vi.mock("@/services/auth.service", () => ({
  checkCurrentUser: vi.fn(),
  login: vi.fn(),
}));

vi.mock("@/lib/i18n/i18n-context", () => ({
  useTranslation: () => ({
    t: {
      auth: {
        welcomeBack: "Welcome back",
        sessionHint: "Sign in",
        emailOrUsername: "Email or username",
        password: "Password",
        rememberDevice: "Remember device",
        enter2faCode: "Enter 2FA code",
        totpCodeLabel: "2FA code",
        signingIn: "Signing in",
        verify2faButton: "Verify",
        signIn: "Sign in",
        createAccount: "Create account",
        forgotPassword: "Forgot password",
        loginFailed: "Login failed",
      },
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(document, "cookie", {
    configurable: true,
    value: "",
  });
});

describe("LoginPage session detection", () => {
  it("does not request the current user for a logged-out visitor", () => {
    render(<LoginPage />);

    expect(checkCurrentUser).not.toHaveBeenCalled();
  });

  it("redirects an authenticated visitor who manually opens login", async () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      value: "csrf_token=session-hint",
    });
    vi.mocked(checkCurrentUser).mockResolvedValue({
      id: "9e86bb49-d24c-4c3a-a6e5-f8b1a9aaeb84",
      email: "trader@example.com",
      username: "trader",
      emailVerified: true,
      totpEnabled: false,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    });

    render(<LoginPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/profile"));
    expect(checkCurrentUser).toHaveBeenCalledTimes(1);
  });
});
