import { publicUserSchema, sessionViewSchema } from "@platform/shared";
import { z } from "zod";

import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { apiRequest, apiRequestValidated } from "@/lib/api-client";

export async function checkCurrentUser() {
  return apiRequestValidated(API_ENDPOINTS.auth.me, publicUserSchema);
}

export async function login(payload: {
  identifier: string;
  password: string;
  rememberMe: boolean;
  code?: string;
}) {
  return apiRequest<{ requiresTotp?: boolean }>(API_ENDPOINTS.auth.login, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function logout() {
  return apiRequest(API_ENDPOINTS.auth.logout, { method: "POST" });
}

export async function register(payload: {
  email: FormDataEntryValue | null;
  username: FormDataEntryValue | null;
  password: FormDataEntryValue | null;
}) {
  return apiRequest<{ requiresEmailVerification: boolean }>(API_ENDPOINTS.auth.register, {
    method: "POST",
    body: JSON.stringify({
      email: payload.email,
      username: payload.username,
      password: payload.password,
    }),
  });
}

export async function verifyEmail(token: string) {
  return apiRequest(API_ENDPOINTS.auth.verifyEmail, {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function resendVerification(email: string) {
  return apiRequest(API_ENDPOINTS.auth.resendVerification, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, newPassword: FormDataEntryValue | null) {
  return apiRequest(API_ENDPOINTS.auth.resetPassword, {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
}

export async function changePassword(payload: { currentPassword: FormDataEntryValue | null; newPassword: FormDataEntryValue | null }) {
  return apiRequest(API_ENDPOINTS.auth.changePassword, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getSessions() {
  return apiRequestValidated(API_ENDPOINTS.auth.sessions, z.array(sessionViewSchema));
}

export async function removeSession(id: string, totpCode?: string) {
  return apiRequest(API_ENDPOINTS.auth.sessionsById(id), {
    method: "DELETE",
    ...(totpCode ? { headers: { "X-TOTP-Code": totpCode } } : {}),
  });
}

export async function removeAllSessions() {
  return apiRequest(API_ENDPOINTS.auth.sessions, { method: "DELETE" });
}

export async function reauthenticate(password: string) {
  return apiRequest(API_ENDPOINTS.auth.reauthenticate, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function setupTotp() {
  return apiRequest<{ secret: string; otpauthUri: string }>(API_ENDPOINTS.auth.totpSetup, { method: "POST" });
}

export async function confirmTotp(code: FormDataEntryValue | null) {
  return apiRequest(API_ENDPOINTS.auth.totpConfirm, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function disableTotp(payload: { currentPassword: FormDataEntryValue | null; code: FormDataEntryValue | null }) {
  return apiRequest(API_ENDPOINTS.auth.totpDisable, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
