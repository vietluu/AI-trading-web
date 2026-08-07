import { createServer } from "node:net";

export async function getAvailablePort(
  startPort: number,
  maxAttempts = 50,
): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port += 1) {
    const server = createServer();

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("error", onError);
          reject(error);
        };

        server.once("error", onError);
        server.listen(port, "0.0.0.0", () => {
          server.close(() => {
            server.off("error", onError);
            resolve();
          });
        });
      });

      return port;
    } catch (error) {
      if (isAddressInUseError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `Unable to find a free port after ${maxAttempts} attempts starting from ${startPort}`,
  );
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
  );
}
