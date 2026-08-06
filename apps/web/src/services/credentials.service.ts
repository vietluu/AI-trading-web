import { credentialViewSchema } from "@platform/shared";
import { z } from "zod";

import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { apiRequest, apiRequestValidated } from "@/lib/api-client";

export async function listCredentials() {
  return apiRequestValidated(API_ENDPOINTS.credentials.root, z.array(credentialViewSchema));
}

export async function createCredential(payload: {
  provider: FormDataEntryValue | null;
  label?: FormDataEntryValue | null;
  apiKey: FormDataEntryValue | null;
  secret?: FormDataEntryValue | null;
  passphrase?: FormDataEntryValue | null;
}, totpCode?: string) {
  return apiRequest(API_ENDPOINTS.credentials.root, {
    method: "POST",
    ...(totpCode ? { headers: { "X-TOTP-Code": totpCode } } : {}),
    body: JSON.stringify({
      provider: payload.provider,
      label: payload.label || undefined,
      apiKey: payload.apiKey,
      secret: payload.secret || undefined,
      passphrase: payload.passphrase || undefined,
    }),
  });
}

export async function testCredential(id: string, totpCode?: string) {
  return apiRequest(API_ENDPOINTS.credentials.test(id), {
    method: "POST",
    ...(totpCode ? { headers: { "X-TOTP-Code": totpCode } } : {}),
  });
}

export async function deleteCredential(id: string, totpCode?: string) {
  return apiRequest(API_ENDPOINTS.credentials.byId(id), {
    method: "DELETE",
    ...(totpCode ? { headers: { "X-TOTP-Code": totpCode } } : {}),
  });
}
