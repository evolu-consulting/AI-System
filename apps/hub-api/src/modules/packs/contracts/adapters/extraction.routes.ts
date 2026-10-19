// HD-FR-24 · HD-FR-26 · HD2 plan: `POST /pack/contracts/contracts/:id/extract` (trích lại ⇒ 202) và
// `POST /pack/contracts/contracts/manual` (nhập tay ⇒ 201). Guard `write` TRƯỚC đọc thân/tham số (viewer ⇒ 403, 0 SQL);
// `:id` sai dạng ⇒ 400; tenant khác ⇒ 404 như không có; thân strict (khoá lạ như `tenant_id` ⇒ 400).
import { CONTRACT_ERRORS, ManualContractRequestSchema } from "@ai/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type { CreateManual } from "../application/create-manual.usecase";
import type { RequestExtract } from "../application/request-extract.usecase";
import type { ManualInput } from "../domain/manual.rules";

const KEY = "contracts";
/** 500 dòng hàng × ~600 byte + trường ≈ < 512 KiB. */
export const MANUAL_BODY_MAX_BYTES = 512 * 1024;

export type ExtractionRoutesDeps = {
  requestExtract: RequestExtract;
  createManual: CreateManual;
  /** HD3 · #221 · trần thao tác AI theo tenant/ngày (vắng ⇒ không giới hạn). */
  quota?: (tenantId: string) => Promise<void>;
};

const tooLarge = () => new AppError("PAYLOAD_TOO_LARGE", 413, "Payload too large");
const whoOf = (u: { tenantId: string; userId: string }) => ({
  tenantId: u.tenantId,
  userId: u.userId,
});

function extractError(
  kind: "not_found" | "busy" | "no_source" | "unavailable" | "not_allowed",
): AppError {
  if (kind === "not_found") return appError("NOT_FOUND");
  if (kind === "busy")
    return new AppError("EXTRACT_BUSY", CONTRACT_ERRORS.EXTRACT_BUSY, "Contract is being read");
  if (kind === "not_allowed")
    return new AppError(
      "EXTRACT_NOT_ALLOWED",
      CONTRACT_ERRORS.EXTRACT_NOT_ALLOWED,
      "Contract can no longer be re-read",
    );
  if (kind === "unavailable")
    return new AppError(
      "AGENT_UNAVAILABLE",
      CONTRACT_ERRORS.AGENT_UNAVAILABLE,
      "Reader not configured",
    );
  return new AppError("NO_SOURCE", CONTRACT_ERRORS.NO_SOURCE, "Nothing to read");
}

export function extractionRoutes(
  view: PackAccessView,
  d: ExtractionRoutesDeps,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const write = packGuard(view, KEY, "write");
  // Khai trước mọi `/contracts/:id` có cùng phương thức (không có) — `manual` không phải uuid nên không lẫn với `:id`.
  r.post(
    "/contracts/manual",
    write,
    bodyLimit({ maxSize: MANUAL_BODY_MAX_BYTES, onError: () => Promise.reject(tooLarge()) }),
    async (c) => {
      const body = parseWith(ManualContractRequestSchema, await readJson(c));
      await d.quota?.(c.get("user").tenantId);
      const out = await d.createManual(whoOf(c.get("user")), body as ManualInput);
      return c.json(out, 201);
    },
  );
  r.post("/contracts/:id/extract", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    await d.quota?.(c.get("user").tenantId);
    const out = await d.requestExtract(whoOf(c.get("user")), id);
    if (out.kind !== "ok") throw extractError(out.kind);
    return c.json({ id, status: "extracting", version: out.version }, 202);
  });
  return r;
}
