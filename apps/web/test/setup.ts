import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:3001";
