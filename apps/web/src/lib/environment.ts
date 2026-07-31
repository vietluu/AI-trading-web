import { z } from "zod";

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
});

export const publicEnvironment = publicEnvironmentSchema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});
