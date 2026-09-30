// ADM-NFR-06 · contract GET /health (spec M0 §3.1).
import { z } from "zod";

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
