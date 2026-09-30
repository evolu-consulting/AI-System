// ADM-NFR-06 · định dạng lỗi chung {error:{code,message,details?}} (CONVENTIONS §5, spec M0 §3.1).
import { z } from "zod";

export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
        message: z.string().min(1).max(500),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const BASE_ERROR_CODES = ["NOT_FOUND", "INTERNAL_ERROR"] as const;

export type BaseErrorCode = (typeof BASE_ERROR_CODES)[number];
