import {
  exchangeAccountSummarySchema,
  exchangeBalanceSchema,
  exchangeConnectionSchema,
  exchangeConnectionTestSchema,
  exchangeOrderSchema,
  exchangePositionSchema,
} from "@platform/shared";
import { z } from "zod";

import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { apiRequest, apiRequestValidated } from "@/lib/api-client";

export async function getExchangeConnections() {
  return apiRequestValidated(API_ENDPOINTS.exchangeConnections.root, z.array(exchangeConnectionSchema));
}

export async function getExchangeConnection(id: string) {
  return apiRequestValidated(API_ENDPOINTS.exchangeConnections.byId(id), exchangeConnectionSchema);
}

export async function getExchangeAccount(id: string) {
  return apiRequestValidated(API_ENDPOINTS.exchangeConnections.account(id), exchangeAccountSummarySchema);
}

export async function getExchangeBalances(id: string) {
  return apiRequestValidated(API_ENDPOINTS.exchangeConnections.balances(id), z.array(exchangeBalanceSchema));
}

export async function getExchangePositions(id: string) {
  return apiRequestValidated(API_ENDPOINTS.exchangeConnections.positions(id), z.array(exchangePositionSchema));
}

export async function getExchangeOpenOrders(id: string) {
  return apiRequestValidated(API_ENDPOINTS.exchangeConnections.openOrders(id), z.array(exchangeOrderSchema));
}

export async function testExchangeConnection(id: string) {
  return apiRequestValidated(API_ENDPOINTS.exchangeConnections.test(id), exchangeConnectionTestSchema, { method: "POST" });
}

export async function toggleExchangeConnection(id: string, action: "enable" | "disable", totpCode?: string) {
  const endpoint =
    action === "enable"
      ? API_ENDPOINTS.exchangeConnections.enable(id)
      : API_ENDPOINTS.exchangeConnections.disable(id);

  return apiRequest(endpoint, {
    method: "POST",
    ...(totpCode ? { headers: { "X-TOTP-Code": totpCode } } : {}),
  });
}

export async function updateExchangeConnection(id: string, payload: { displayName?: string | null }, totpCode?: string) {
  return apiRequest(API_ENDPOINTS.exchangeConnections.byId(id), {
    method: "PATCH",
    ...(totpCode ? { headers: { "X-TOTP-Code": totpCode } } : {}),
    body: JSON.stringify(payload),
  });
}

export async function replaceExchangeCredentials(id: string, payload: { apiKey: FormDataEntryValue | null; apiSecret: FormDataEntryValue | null; passphrase?: FormDataEntryValue | null }, totpCode?: string) {
  return apiRequest(API_ENDPOINTS.exchangeConnections.byId(id), {
    method: "PATCH",
    ...(totpCode ? { headers: { "X-TOTP-Code": totpCode } } : {}),
    body: JSON.stringify(payload),
  });
}

export async function deleteExchangeConnection(id: string, totpCode?: string) {
  return apiRequest(API_ENDPOINTS.exchangeConnections.byId(id), {
    method: "DELETE",
    ...(totpCode ? { headers: { "X-TOTP-Code": totpCode } } : {}),
  });
}
