"use client";

import { useEffect } from "react";

type ServiceWorkerRegistrar = Pick<ServiceWorkerContainer, "register">;

export function registerPwaServiceWorker(
  serviceWorker: ServiceWorkerRegistrar,
): Promise<ServiceWorkerRegistration> {
  return serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
}

export function PwaRegistration(): null {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    void registerPwaServiceWorker(navigator.serviceWorker).catch(() => {
      // A failed registration must not interrupt the trading interface.
    });
  }, []);

  return null;
}
