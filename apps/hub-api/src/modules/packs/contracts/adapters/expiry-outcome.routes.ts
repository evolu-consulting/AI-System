// CR-127 · SG1 · BR-67/68 · spec §4.1: `POST /contracts/:id/expiry-outcome {outcome: renew|terminate|let_expire, evidence}`. Guard `write` TRƯỚC đọc thân/tham số
// (viewer ⇒ 403, 0 SQL); `:id` sai dạng ⇒ 400; thân strict; HĐ lạ / tenant khác ⇒ 404. Quyền (owner ∪ trưởng phòng ∪ quản trị) + trạng thái + quy trình khớp kiểm ở use case.
import {
  EXEC_ERRORS,
  EXPIRY_ERRORS,
  type ExpiryErrorCode,
  ExpiryOutcomeRequestSchema,
} from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import { ExecFail } from "../application/exec-request.usecase";
import { type ExpiryCommand, ExpiryFail } from "../application/expiry-outcome.usecase";
import { EXEC_MESSAGES, execWho } from "./exec-errors";

export const EXPIRY_MESSAGES: Record<ExpiryErrorCode, string> = {
  EXPIRY_FORBIDDEN:
    "Chỉ người phụ trách, trưởng phòng của họ hoặc quản trị công ty được quyết kết cục hiệu lực của hợp đồng.",
  EXPIRY_NOT_ALLOWED: "Chỉ quyết được khi hợp đồng đã duyệt đang ở trạng thái Sắp hết hạn.",
  EXPIRY_IN_FLOW:
    "Hợp đồng này đi theo quy trình Sắp hết hạn của công ty — quyết trong việc của quy trình (mục Việc của tôi).",
  EXPIRY_DECIDED: "Hợp đồng đã có kết cục (Đã gia hạn / Đã chấm dứt).",
};
const CODE: Record<Exclude<ExpiryFail["kind"], "not_found">, ExpiryErrorCode> = {
  forbidden: "EXPIRY_FORBIDDEN",
  not_allowed: "EXPIRY_NOT_ALLOWED",
  in_flow: "EXPIRY_IN_FLOW",
  decided: "EXPIRY_DECIDED",
};

const mapError = (e: unknown): never => {
  if (e instanceof ExecFail && e.kind === "evidence_required")
    throw new AppError(
      "EVIDENCE_REQUIRED",
      EXEC_ERRORS.EVIDENCE_REQUIRED,
      EXEC_MESSAGES.EVIDENCE_REQUIRED,
    );
  if (!(e instanceof ExpiryFail)) throw e;
  if (e.kind === "not_found") throw appError("NOT_FOUND");
  const code = CODE[e.kind];
  throw new AppError(code, EXPIRY_ERRORS[code], EXPIRY_MESSAGES[code]);
};

export function expiryOutcomeRoutes(view: PackAccessView, cmd: ExpiryCommand): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.post("/contracts/:id/expiry-outcome", packGuard(view, "contracts", "write"), async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const b = parseWith(ExpiryOutcomeRequestSchema, await readJson(c));
    return c.json(await cmd(await execWho(view, c), id, b).catch(mapError));
  });
  return r;
}
