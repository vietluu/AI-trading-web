export const DEFAULT_SOCKET_IO_PATH = "/socket.io/";

export function resolveSocketIoPath(env: NodeJS.ProcessEnv = process.env): string {
  const configuredPath = env.SOCKET_IO_PATH?.trim();

  if (!configuredPath) {
    return DEFAULT_SOCKET_IO_PATH;
  }

  const normalizedPath = configuredPath.startsWith("/")
    ? configuredPath
    : `/${configuredPath}`;

  return normalizedPath.endsWith("/")
    ? normalizedPath
    : `${normalizedPath}/`;
}
