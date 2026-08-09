import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import manifest from "@/app/manifest";
import { registerPwaServiceWorker } from "@/components/pwa-registration";

describe("PWA support", () => {
  it("exposes an installable standalone manifest", () => {
    const value = manifest();

    expect(value).toMatchObject({
      name: "AI Trading Research",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icon.jpg",
          sizes: "1024x1024",
        }),
      ]),
    );
  });

  it("registers the root service worker without HTTP cache reuse", async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);

    await expect(registerPwaServiceWorker({ register })).resolves.toBe(
      registration,
    );
    expect(register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  });

  it("keeps API and socket traffic outside the offline cache", () => {
    const serviceWorker = readFileSync(
      resolve(process.cwd(), "public/sw.js"),
      "utf8",
    );

    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain('url.pathname.startsWith("/socket.io/")');
  });
});
