import { describe, expect, it } from "vitest";

import { DEFAULT_SOCKET_IO_PATH, resolveSocketIoPath } from "../../src/common/utils/socket-io-path";

describe("resolveSocketIoPath", () => {
  it("returns the default Socket.IO path when no override is provided", () => {
    expect(resolveSocketIoPath({})).toBe(DEFAULT_SOCKET_IO_PATH);
  });

  it("normalizes explicit relative path values", () => {
    expect(resolveSocketIoPath({ SOCKET_IO_PATH: "socket.io" })).toBe("/socket.io/");
  });

  it("preserves an absolute path and trailing slash", () => {
    expect(resolveSocketIoPath({ SOCKET_IO_PATH: "/custom/socket.io" })).toBe("/custom/socket.io/");
  });
});
