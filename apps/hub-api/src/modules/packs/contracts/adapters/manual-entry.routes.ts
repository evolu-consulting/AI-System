// CR-157: `POST /contracts/:id/manual-entry` (DRAFT + AI đọc lỗi ⇒ nhập tay) · `PUT /contracts/:id/reconcile` (tích/bỏ "đã đối chiếu với tệp gốc").
// Guard `write` TRƯỚC đọc thân; `:id` sai ⇒ 400; không thấy / tenant khác ⇒ 404; không phải người tạo ∪ phụ trách ⇒ 403;
// đang đọc ⇒ 409 `EXTRACT_BUSY`; không đủ điều kiện ⇒ 409 `MANUAL_NOT_ALLOWED` / `NOT_MANUAL`.
import {
  CONTRACT_ERRORS,
  MANUAL_ENTRY_ERRORS,
  ManualEntryRequestSchema,
  ReconcileRequestSchema,
} from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import type {
  ManualErr,
  reconcileEntry,
  startManualEntry,
} from "../application/manual-entry.usecase";

const MSG = {
  MANUAL_NOT_ALLOWED: "Chỉ nhập tay được khi AI đọc lỗi hoặc hết giờ.",
  NOT_MANUAL: "Hợp đồng này không phải nhập tay.",
} as const;
const whoOf = (u: { tenantId: string; userId: string }) => ({
  tenantId: u.tenantId,
  userId: u.userId,
});

function fail(e: ManualErr): never {
  if (e === "not_found") throw appError("NOT_FOUND");
  if (e === "forbidden") throw appError("FORBIDDEN");
  if (e === "busy")
    throw new AppError("EXTRACT_BUSY", CONTRACT_ERRORS.EXTRACT_BUSY, "Contract is being read");
  throw new AppError(e, MANUAL_ENTRY_ERRORS[e], MSG[e]);
}

export function manualEntryRoutes(
  view: PackAccessView,
  d: { start: ReturnType<typeof startManualEntry>; reconcile: ReturnType<typeof reconcileEntry> },
) {
  const r = new Hono<PackGuardVars>();
  const write = packGuard(view, "contracts", "write");
  r.post("/contracts/:id/manual-entry", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    parseWith(ManualEntryRequestSchema, await readJson(c));
    const out = await d.start(whoOf(c.get("user")), id);
    if ("error" in out) fail(out.error);
    return c.json({
      id,
      status: "draft",
      extract_state: "ready",
      entry_source: "manual",
      version: out.version,
    });
  });
  r.put("/contracts/:id/reconcile", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const b = parseWith(ReconcileRequestSchema, await readJson(c));
    const out = await d.reconcile(whoOf(c.get("user")), id, b.reconciled);
    if ("error" in out) fail(out.error);
    return c.json({ id, reconciled_by: out.by, reconciled_at: out.at });
  });
  return r;
}
